"""
同心环检测 — 径向颜色梯度法 (改进版: 白环定心 + 小球遮罩)
用法:
  python analyze_circles.py <video>                    # 自动检测
  python analyze_circles.py <video> --center 148,168   # 手动指定中心
  python analyze_circles.py <video> --preview          # 实时预览
"""

import cv2
import numpy as np
import json
import argparse
import sys
from pathlib import Path


def find_hud_center(frame: np.ndarray) -> tuple[int, int]:
    """
    用最大亮环定圆心:
    1. 高阈值二值化 → 只留白环
    2. 找轮廓 → 取最大的近圆轮廓
    3. 用 minEnclosingCircle 得到圆心
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)
    h, w = gray.shape

    # 高阈值：只保留白环区域 (值>180)
    _, bright_mask = cv2.threshold(blurred, 180, 255, cv2.THRESH_BINARY)

    # 形态学：闭运算连接白环，开运算去除小球等小亮点
    kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (20, 20))
    bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel_close)
    bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_OPEN, kernel_open)

    contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if contours:
        # 取面积最大的轮廓 (应该是白环)
        biggest = max(contours, key=cv2.contourArea)
        (cx, cy), radius = cv2.minEnclosingCircle(biggest)
        return int(cx), int(cy)

    # 回退: 遮盖右下1/4后用边缘质心
    edges = cv2.Canny(blurred, 40, 100)
    edges[h * 2 // 3:, w * 2 // 3:] = 0  # 遮盖小球区域
    ey, ex = np.where(edges > 0)
    if len(ex) > 0:
        return int(np.mean(ex)), int(np.mean(ey))

    return w // 2, h // 2


def create_ball_mask(frame: np.ndarray, cx: int, cy: int, max_r: int) -> np.ndarray:
    """
    创建小球遮罩: 找到白色小球并遮盖它
    返回一个 (h, w) 的 mask，小球区域为 0，其余为 1
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    mask = np.ones((h, w), dtype=np.uint8)

    # 高阈值找白色区域
    _, bright = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # 找轮廓
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 50 or area > 5000:  # 小球面积范围
            continue
        (bx, by), br = cv2.minEnclosingCircle(cnt)
        # 圆度检查
        perimeter = cv2.arcLength(cnt, True)
        if perimeter == 0:
            continue
        circularity = 4 * np.pi * area / (perimeter * perimeter)
        if circularity < 0.5:
            continue
        # 必须在 HUD 范围内且不在正中心
        dist_to_center = ((bx - cx) ** 2 + (by - cy) ** 2) ** 0.5
        if dist_to_center < 10 or dist_to_center > max_r:
            continue
        # 遮盖这个小球 (扩大一点范围)
        cv2.circle(mask, (int(bx), int(by)), int(br * 2.5), 0, -1)

    return mask


def radial_profiles_bgr(
    frame: np.ndarray, cx: int, cy: int, max_r: int,
    ball_mask: np.ndarray | None = None, num_angles: int = 360,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """BGR 三通道径向剖面 (角度平均), 用于颜色报告"""
    h, w = frame.shape[:2]
    angles = np.linspace(0, 2 * np.pi, num_angles, endpoint=False)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)
    rs = np.arange(max_r)

    all_x = np.clip((cx + rs[None, :] * cos_a[:, None]).astype(int), 0, w - 1)
    all_y = np.clip((cy + rs[None, :] * sin_a[:, None]).astype(int), 0, h - 1)

    sampled = frame[all_y, all_x].astype(np.float64)  # (num_angles, max_r, 3)

    if ball_mask is not None:
        bmask = ball_mask[all_y, all_x] > 0
        sampled[~bmask] = np.nan

    with np.errstate(all='ignore'):
        avg = np.nanmean(sampled, axis=0)  # (max_r, 3)
    avg = np.nan_to_num(avg)

    return avg[:, 0], avg[:, 1], avg[:, 2]


def compute_per_ray_edges(
    frame: np.ndarray, cx: int, cy: int, max_r: int,
    ball_mask: np.ndarray | None = None, num_angles: int = 180,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    逐射线梯度法: 每条射线独立计算梯度，再聚合。
    返回 (mean_edge, p75_edge, std_edge, color_var):
      - mean: 适合检测完整圆环
      - p75: 适合检测旋转/局部特征 (陀螺仪)
      - std: 角度方差 — 高方差意味着局部特征 (旋转元件)
      - color_var: 每个半径上颜色的角度方差 (检测旋转体)
    """
    h, w = frame.shape[:2]
    angles = np.linspace(0, 2 * np.pi, num_angles, endpoint=False)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)
    rs = np.arange(max_r)

    all_x = np.clip((cx + rs[None, :] * cos_a[:, None]).astype(int), 0, w - 1)
    all_y = np.clip((cy + rs[None, :] * sin_a[:, None]).astype(int), 0, h - 1)

    sampled = frame[all_y, all_x].astype(np.float64)  # (num_angles, max_r, 3)

    if ball_mask is not None:
        bmask = ball_mask[all_y, all_x] > 0
        sampled[~bmask] = 0

    k = np.array([1, 2, 4, 2, 1], dtype=np.float64)
    k /= k.sum()

    edge_map = np.zeros((num_angles, max_r), dtype=np.float64)

    for ai in range(num_angles):
        ray = sampled[ai]  # (max_r, 3)
        smoothed = np.zeros_like(ray)
        for ch in range(3):
            smoothed[:, ch] = np.convolve(ray[:, ch], k, mode='same')

        # 亮度梯度
        grad = np.abs(np.gradient(smoothed, axis=0))  # (max_r, 3)
        lum_edge = np.max(grad, axis=1)

        # 色彩梯度
        bg_d = np.abs(np.gradient(np.abs(smoothed[:, 0] - smoothed[:, 1])))
        br_d = np.abs(np.gradient(np.abs(smoothed[:, 0] - smoothed[:, 2])))
        gr_d = np.abs(np.gradient(np.abs(smoothed[:, 1] - smoothed[:, 2])))
        color_edge = np.maximum(np.maximum(bg_d, br_d), gr_d)

        edge_map[ai] = lum_edge + color_edge * 0.8

    mean_edge = np.mean(edge_map, axis=0)
    p75_edge = np.percentile(edge_map, 75, axis=0)
    std_edge = np.std(edge_map, axis=0)

    # 颜色角度方差: 每个半径上 BGR 值的方差 (检测旋转体颜色不均匀)
    color_var = np.mean(np.std(sampled, axis=0), axis=1)  # mean of per-channel std

    return mean_edge, p75_edge, std_edge, color_var


def compute_edge_profile(b: np.ndarray, g: np.ndarray, r: np.ndarray) -> np.ndarray:
    """旧方法: 从角度平均 BGR 算梯度 (仅用于 Pass 2 快速追踪)"""
    k = np.array([1, 2, 3, 2, 1], dtype=np.float64)
    k /= k.sum()

    bs = np.convolve(b, k, mode='same')
    gs = np.convolve(g, k, mode='same')
    rs = np.convolve(r, k, mode='same')

    bg = np.abs(np.gradient(bs))
    gg = np.abs(np.gradient(gs))
    rg = np.abs(np.gradient(rs))

    lum_edge = np.maximum(np.maximum(bg, gg), rg)

    bg_d = np.abs(np.gradient(np.convolve(np.abs(bs - gs), k, mode='same')))
    br_d = np.abs(np.gradient(np.convolve(np.abs(bs - rs), k, mode='same')))
    gr_d = np.abs(np.gradient(np.convolve(np.abs(gs - rs), k, mode='same')))
    color_edge = np.maximum(np.maximum(bg_d, br_d), gr_d)

    return lum_edge + color_edge * 0.8


def find_edge_peaks(profile: np.ndarray, min_prom: float = 1.5, min_dist: int = 3,
                    min_r: int = 8, max_r: int | None = None) -> list[dict]:
    data = profile.copy()
    data[:min_r] = 0
    if max_r is not None:
        data[max_r:] = 0
    peaks = []
    n = len(data)
    for i in range(2, n - 2):
        if data[i] <= data[i-1] or data[i] <= data[i+1]:
            continue
        left_min = np.min(data[max(0, i-15):i])
        right_min = np.min(data[i+1:min(n, i+16)])
        prom = data[i] - max(left_min, right_min)
        if prom < min_prom:
            continue
        if peaks and (i - peaks[-1]["radius"]) < min_dist:
            if data[i] > peaks[-1]["edge_strength"]:
                peaks[-1] = {"radius": i, "edge_strength": float(data[i]), "prominence": float(prom)}
            continue
        peaks.append({"radius": i, "edge_strength": float(data[i]), "prominence": float(prom)})
    return peaks


def find_color_steps(avg_b: np.ndarray, avg_g: np.ndarray, avg_r: np.ndarray,
                     min_r: int = 15, max_r: int | None = None,
                     window: int = 6, min_step: float = 25.0,
                     min_dist: int = 8) -> tuple[list[dict], np.ndarray]:
    """
    颜色阶跃法: 比较每个半径两侧窗口的平均颜色差异 (欧氏距离).
    比梯度峰值法更鲁棒——能准确找到人眼可见的区域分界线,
    而非梯度最陡点 (梯度峰常偏移真实边界 5-10px).

    返回 (boundaries, step_profile)
    """
    n = len(avg_b)
    lo = min_r + window
    hi = min(max_r or n, n) - window
    step = np.zeros(n, dtype=np.float64)

    for r in range(lo, hi):
        b_in = np.mean(avg_b[r - window:r])
        g_in = np.mean(avg_g[r - window:r])
        r_in = np.mean(avg_r[r - window:r])
        b_out = np.mean(avg_b[r:r + window])
        g_out = np.mean(avg_g[r:r + window])
        r_out = np.mean(avg_r[r:r + window])
        step[r] = ((b_in - b_out)**2 + (g_in - g_out)**2 + (r_in - r_out)**2) ** 0.5

    # 在阶跃剖面中找峰值
    peaks = find_edge_peaks(step, min_prom=min_step * 0.15, min_dist=min_dist,
                            min_r=lo, max_r=hi)

    # 只保留阶跃强度 >= min_step 的
    boundaries = [pk for pk in peaks if step[pk["radius"]] >= min_step]
    for b in boundaries:
        b["color_step"] = float(step[b["radius"]])

    return boundaries, step


def color_name(b, g, r):
    mx = max(b, g, r)
    if mx < 25:
        return "black"
    if mx > 210 and min(b, g, r) > 150:
        return f"white({b:.0f},{g:.0f},{r:.0f})"
    if abs(b - g) < 20 and abs(b - r) < 20:
        if mx > 180:
            return f"light-gray({b:.0f},{g:.0f},{r:.0f})"
        return f"gray({b:.0f},{g:.0f},{r:.0f})"
    if b > g and b > r:
        return f"blue({b:.0f},{g:.0f},{r:.0f})"
    if g > b and g > r:
        return f"green({b:.0f},{g:.0f},{r:.0f})"
    if r > b and r > g:
        return f"red({b:.0f},{g:.0f},{r:.0f})"
    return f"({b:.0f},{g:.0f},{r:.0f})"


def describe_boundary(bp, gp, rp, radius, half_w: int = 5):
    """采样分界线两侧 half_w 像素的平均颜色"""
    n = len(bp)
    i_lo, i_hi = max(0, radius - half_w), radius
    o_lo, o_hi = radius, min(n, radius + half_w)
    ib = np.mean(bp[i_lo:i_hi]) if i_hi > i_lo else bp[max(0, radius - 1)]
    ig = np.mean(gp[i_lo:i_hi]) if i_hi > i_lo else gp[max(0, radius - 1)]
    ir = np.mean(rp[i_lo:i_hi]) if i_hi > i_lo else rp[max(0, radius - 1)]
    ob = np.mean(bp[o_lo:o_hi]) if o_hi > o_lo else bp[min(n - 1, radius + 1)]
    og = np.mean(gp[o_lo:o_hi]) if o_hi > o_lo else gp[min(n - 1, radius + 1)]
    or_ = np.mean(rp[o_lo:o_hi]) if o_hi > o_lo else rp[min(n - 1, radius + 1)]
    return f"{color_name(ib, ig, ir)} -> {color_name(ob, og, or_)}"


def analyze_video(video_path: str, sample_every: int = 2, preview: bool = False,
                  min_prom: float = 1.5, min_r: int = 8, max_r_cut: int = 130,
                  center: tuple[int, int] | None = None) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"Error: cannot open {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    max_r = min(w, h) // 2

    print(f"Video: {w}x{h} @ {fps:.1f}fps, {total} frames ({total/fps:.1f}s)")
    print(f"  max_radius={max_r}, sample_every={sample_every}")

    # 找中心
    ret, first = cap.read()
    if center:
        cx, cy = center
        print(f"  HUD center (manual): ({cx}, {cy})")
    else:
        cx, cy = find_hud_center(first)
        print(f"  HUD center (auto, white-ring method): ({cx}, {cy})")

    # 创建小球遮罩
    ball_mask = create_ball_mask(first, cx, cy, max_r)
    ball_pixels_masked = np.sum(ball_mask == 0)
    print(f"  Ball mask: {ball_pixels_masked} pixels masked")

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # ── Pass 1: 逐射线边缘剖面 ──
    print("\n  Pass 1: Per-ray edge profiling (mean + P75 + std + color_var)...")
    avg_mean_edge = np.zeros(max_r, dtype=np.float64)
    avg_p75_edge = np.zeros(max_r, dtype=np.float64)
    avg_std_edge = np.zeros(max_r, dtype=np.float64)
    avg_color_var = np.zeros(max_r, dtype=np.float64)
    avg_b = np.zeros(max_r, dtype=np.float64)
    avg_g = np.zeros(max_r, dtype=np.float64)
    avg_r_ch = np.zeros(max_r, dtype=np.float64)
    all_frame_peaks = []  # 逐帧边界位置累积
    n_frames = 0
    fidx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fidx % sample_every == 0:
            bm = create_ball_mask(frame, cx, cy, max_r)
            bp, gp, rp = radial_profiles_bgr(frame, cx, cy, max_r, ball_mask=bm, num_angles=180)
            mean_e, p75_e, std_e, cvar = compute_per_ray_edges(
                frame, cx, cy, max_r, ball_mask=bm, num_angles=180)
            avg_mean_edge += mean_e
            avg_p75_edge += p75_e
            avg_std_edge += std_e
            avg_color_var += cvar
            avg_b += bp
            avg_g += gp
            avg_r_ch += rp

            # ★ 逐帧颜色阶跃检测 (避免帧平均模糊边界)
            frame_bounds, _ = find_color_steps(
                bp, gp, rp, min_r=min_r, max_r=max_r_cut,
                window=4, min_step=10.0, min_dist=4)
            for fb in frame_bounds:
                all_frame_peaks.append(fb["radius"])

            n_frames += 1
            if n_frames % 20 == 0:
                print(f"    sampled {n_frames} frames...")
        fidx += 1

    avg_mean_edge /= max(n_frames, 1)
    avg_p75_edge /= max(n_frames, 1)
    avg_std_edge /= max(n_frames, 1)
    avg_color_var /= max(n_frames, 1)
    avg_b /= max(n_frames, 1)
    avg_g /= max(n_frames, 1)
    avg_r_ch /= max(n_frames, 1)

    # 综合评分 (仅用于逐帧追踪和可视化)
    avg_edge = 0.4 * avg_mean_edge + 0.6 * avg_p75_edge

    # 帧平均的阶跃剖面 (仅用于可视化, 不用于检测)
    _, step_profile = find_color_steps(
        avg_b, avg_g, avg_r_ch,
        min_r=min_r, max_r=max_r_cut,
        window=4, min_step=10.0, min_dist=4)

    # ── 主检测: 逐帧边界直方图聚类 ──
    # 每帧独立检测边界位置, 然后用直方图找到频繁出现的位置
    print(f"\n  Primary detection: Per-frame histogram clustering "
          f"({len(all_frame_peaks)} peaks from {n_frames} frames)...")

    hit_hist = np.zeros(max_r, dtype=np.float64)
    for pos in all_frame_peaks:
        if 0 <= pos < max_r:
            hit_hist[pos] += 1

    # 平滑直方图 (高斯近似, 宽度3)
    k_smooth = np.array([1, 3, 5, 3, 1], dtype=np.float64)
    k_smooth /= k_smooth.sum()
    smooth_hist = np.convolve(hit_hist, k_smooth, mode='same')[:max_r]

    # 在平滑直方图中找峰值
    min_hits = n_frames * 0.10  # 至少 10% 帧出现
    hist_peaks = find_edge_peaks(smooth_hist, min_prom=min_hits * 0.3,
                                  min_dist=5, min_r=min_r, max_r=max_r_cut)
    rings = [pk for pk in hist_peaks if smooth_hist[pk["radius"]] >= min_hits]

    # 为每个边界添加颜色阶跃信息
    for ring in rings:
        r = ring["radius"]
        ring["color_step"] = float(step_profile[r]) if r < len(step_profile) else 0
        ring["hit_count"] = float(hit_hist[r])
        ring["hit_rate"] = round(float(smooth_hist[r]) / n_frames, 2)

    # ── Debug: 直方图在肉眼标注半径附近的值 ──
    gt_radii = [68, 92, 97, 125, 167, 193, 196]
    print(f"\n  [Debug] Histogram values at ground truth radii:")
    for gr in gt_radii:
        if gr < len(smooth_hist):
            sv = smooth_hist[gr]
            nearby = [(r, f"{smooth_hist[r]:.1f}") for r in range(max(0, gr-3), min(len(smooth_hist), gr+4))]
            nearby_str = " ".join(f"{r}:{v}" for r, v in nearby)
            print(f"    r={gr:>3}: hits={sv:>5.1f} ({sv/n_frames*100:.0f}%)  nearby=[{nearby_str}]")

    # 排序和编号
    rings.sort(key=lambda r: r["radius"])
    for i, ring in enumerate(rings):
        ring["id"] = i

    print(f"\n  Found {len(rings)} total boundaries (r={min_r}..{max_r_cut}):\n")

    tracks = {}
    for i, ring in enumerate(rings):
        r = ring["radius"]
        bd = describe_boundary(avg_b, avg_g, avg_r_ch, r)
        ring["boundary"] = bd
        ring["id"] = i
        cs = ring.get("color_step", 0)
        tracks[i] = {"id": i, "ref_r": r, "boundary": bd,
                      "strength": ring["edge_strength"], "color_step": cs,
                      "samples": []}
        print(f"    #{i:>2}  r={r:>3}px  step={cs:>5.1f}  edge={ring['edge_strength']:>5.1f}  {bd}")

    # ── Pass 2: 逐帧追踪 ──
    print(f"\n  Pass 2: Tracking across {total} frames...")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    fidx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fidx % sample_every != 0:
            fidx += 1
            continue

        bm = create_ball_mask(frame, cx, cy, max_r)
        bp, gp, rp = radial_profiles_bgr(frame, cx, cy, max_r, ball_mask=bm, num_angles=180)
        edge = compute_edge_profile(bp, gp, rp)
        fpks = find_edge_peaks(edge, min_prom * 0.5, min_dist=2)

        for tid, t in tracks.items():
            ref = t["ref_r"]
            best, bdiff = None, 15
            for pk in fpks:
                d = abs(pk["radius"] - ref)
                if d < bdiff:
                    bdiff = d
                    best = pk
            if best:
                t["samples"].append({
                    "frame": fidx,
                    "radius": best["radius"],
                    "edge": round(best["edge_strength"], 1),
                })

        if preview:
            vis = frame.copy()
            cv2.drawMarker(vis, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 8, 1)
            colors = [(0,255,0),(255,100,0),(0,200,255),(255,0,200),
                      (100,255,100),(255,255,0),(0,100,255),(200,0,255),
                      (255,180,0),(0,255,200),(128,255,128),(255,128,0)]
            for tid, t in tracks.items():
                if not t["samples"] or t["samples"][-1]["frame"] != fidx:
                    continue
                r = t["samples"][-1]["radius"]
                c = colors[tid % len(colors)]
                cv2.circle(vis, (cx, cy), r, c, 1)
                ang = tid * 28 + 10
                lx = int(cx + r * np.cos(np.radians(ang)))
                ly = int(cy + r * np.sin(np.radians(ang)))
                cv2.putText(vis, f"#{tid} r={r}", (lx+2, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.3, c, 1)

            # edge profile sidebar
            sb = np.zeros((h, 200, 3), dtype=np.uint8)
            if max(edge) > 0:
                ne = edge / max(edge) * 180
                for ri in range(1, min(len(ne), h)):
                    cv2.line(sb, (int(ne[ri-1]), ri-1), (int(ne[ri]), ri), (0,200,0), 1)
                for tid, t in tracks.items():
                    rr = t["ref_r"]
                    if rr < h:
                        c = colors[tid % len(colors)]
                        cv2.line(sb, (0, rr), (199, rr), c, 1)

            cv2.imshow("Ring Analysis [q=quit]", np.hstack([vis, sb]))
            if (cv2.waitKey(1) & 0xFF) in (ord('q'), 27):
                break

        if fidx % 60 == 0:
            print(f"    frame {fidx}/{total}")
        fidx += 1

    cap.release()
    if preview:
        cv2.destroyAllWindows()

    # ── 报告 ──
    summaries = []
    for tid, t in tracks.items():
        samps = t["samples"]
        if len(samps) < 2:
            entry = {
                "ring_id": tid, "ref_radius": t["ref_r"], "boundary": t["boundary"],
                "edge_strength": round(t["strength"], 1),
                "color_step": round(t.get("color_step", 0), 1),
                "frames": len(samps),
                "motion": "insufficient data",
                "radius_avg": float(t["ref_r"]), "radius_min": t["ref_r"],
                "radius_max": t["ref_r"], "radius_change": 0, "timeline": [],
            }
            summaries.append(entry)
            continue

        radii = [s["radius"] for s in samps]
        r_min, r_max = min(radii), max(radii)
        r_avg = sum(radii) / len(radii)
        r_change = r_max - r_min

        motion = "stationary"
        if r_change > 1:
            ra = np.array(radii, dtype=np.float64) - np.mean(radii)
            sc = int(np.sum(np.diff(np.sign(ra)) != 0))
            dur = (samps[-1]["frame"] - samps[0]["frame"]) / fps if fps > 0 else 1
            if sc > 3:
                freq = sc / 2 / dur if dur > 0 else 0
                motion = f"pulsating ~{freq:.1f}Hz, range {r_change}px"
            elif radii[-1] > radii[0] + 2:
                motion = f"expanding +{radii[-1]-radii[0]}px"
            elif radii[-1] < radii[0] - 2:
                motion = f"contracting {radii[-1]-radii[0]}px"
            else:
                motion = f"jittering {r_change}px"

        entry = {
            "ring_id": tid, "ref_radius": t["ref_r"], "boundary": t["boundary"],
            "edge_strength": round(t["strength"], 1),
            "color_step": round(t.get("color_step", 0), 1),
            "radius_avg": round(r_avg, 1), "radius_min": r_min, "radius_max": r_max,
            "radius_change": r_change, "frames": len(samps),
            "motion": motion, "timeline": radii[:200],
        }
        summaries.append(entry)

    summaries.sort(key=lambda s: s["ref_radius"])

    return {
        "video": {"path": video_path, "width": w, "height": h,
                  "fps": round(fps, 2), "total_frames": total,
                  "duration_s": round(total / fps, 2) if fps > 0 else 0},
        "hud_center": {"x": cx, "y": cy},
        "rings": summaries,
        "_edge_profile": avg_edge, "_step_profile": step_profile,
        "_mean_edge": avg_mean_edge, "_p75_edge": avg_p75_edge,
        "_std_edge": avg_std_edge, "_color_var": avg_color_var,
        "_avg_b": avg_b, "_avg_g": avg_g, "_avg_r": avg_r_ch,
        "_max_r": max_r, "_ring_peaks": rings,
    }


def print_report(report: dict):
    v = report["video"]
    c = report["hud_center"]
    rings = report["rings"]

    print("\n" + "=" * 80)
    print(f"  Video: {v['width']}x{v['height']} @ {v['fps']}fps, {v['duration_s']}s")
    print(f"  HUD center: ({c['x']}, {c['y']})")
    print(f"  Rings: {len(rings)}")
    print("=" * 80)
    print(f"\n  {'#':>3} {'R(px)':>6} {'Range':>10} {'Step':>5} {'Edge':>5} {'Frames':>6} {'Boundary':30} {'Motion'}")
    print(f"  " + "-" * 105)
    for r in rings:
        rng = f"{r['radius_min']}-{r['radius_max']}" if r['radius_change'] > 0 else "---"
        cs = r.get('color_step', 0)
        print(f"  {r['ring_id']:>3} {r['ref_radius']:>5} {rng:>10} {cs:>5.1f} {r['edge_strength']:>5.1f} {r['frames']:>6} {r['boundary']:30} {r['motion']}")

    max_r = max((r["ref_radius"] for r in rings), default=1)
    print(f"\n  Layout (center -> out):")
    for r in rings:
        bar = "=" * int(r["ref_radius"] / max_r * 50)
        ch = f" [{r['radius_min']}-{r['radius_max']}]" if r['radius_change'] > 1 else ""
        print(f"  {r['ref_radius']:>4}px {bar}| {r['motion']}{ch}")


def save_edge_profile(report: dict):
    """保存颜色阶跃 + 梯度曲线 + BGR 颜色条"""
    avg_edge = report["_edge_profile"]
    step_profile = report["_step_profile"]
    rings = report["_ring_peaks"]
    max_r = report["_max_r"]
    avg_b, avg_g, avg_r_ch = report["_avg_b"], report["_avg_g"], report["_avg_r"]

    graph_h = 400
    graph_w = max_r * 4
    margin = 50
    total_h = graph_h + 80
    img = np.zeros((total_h, graph_w + margin, 3), dtype=np.uint8)
    img[:] = (30, 30, 30)

    # 两个比例尺: 梯度用 edge_max, 阶跃用 step_max
    edge_max = max(avg_edge.max(), 1)
    step_max = max(step_profile.max(), 1)

    def draw_curve(data, color, thickness=1, scale=None):
        s = scale if scale else edge_max
        for i in range(1, max_r):
            x0 = margin + (i - 1) * 4
            x1 = margin + i * 4
            y0 = graph_h - int(data[i-1] / s * (graph_h - 20))
            y1 = graph_h - int(data[i] / s * (graph_h - 20))
            cv2.line(img, (x0, y0), (x1, y1), color, thickness)

    # 梯度曲线 (暗色, 参考用)
    draw_curve(avg_edge, (0, 120, 0), 1)

    # ★ 颜色阶跃曲线 (亮黄, 主曲线)
    draw_curve(step_profile, (0, 255, 255), 2, scale=step_max)

    # 图例
    cv2.putText(img, "ColorStep (primary)", (margin, 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
    cv2.putText(img, "Gradient (ref)", (margin + 160, 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 120, 0), 1)

    # 标记检测到的分界线 (基于阶跃法)
    ring_colors = [(0,255,0),(255,100,0),(0,200,255),(255,0,200),
                   (100,255,100),(255,255,0),(0,100,255),(200,0,255),
                   (255,180,0),(0,255,200),(128,255,128),(255,128,0)]
    for ring in rings:
        r = ring["radius"]
        x = margin + r * 4
        y = graph_h - int(step_profile[r] / step_max * (graph_h - 20))
        rid = ring.get("id", 0)
        c = ring_colors[rid % len(ring_colors)]
        cv2.circle(img, (x, y), 5, c, -1)
        cv2.line(img, (x, graph_h), (x, y), c, 1)
        cs = ring.get("color_step", 0)
        label = f"#{rid} r={r} s={cs:.0f}"
        cv2.putText(img, label, (x - 10, y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, c, 1)

    # 底部颜色条
    bar_top = graph_h + 10
    bar_h = 30
    for i in range(max_r):
        x = margin + i * 4
        b, g, r = int(avg_b[i]), int(avg_g[i]), int(avg_r_ch[i])
        cv2.rectangle(img, (x, bar_top), (x + 4, bar_top + bar_h), (b, g, r), -1)

    # 标尺
    for i in range(0, max_r, 10):
        x = margin + i * 4
        cv2.line(img, (x, bar_top + bar_h), (x, bar_top + bar_h + 5), (150, 150, 150), 1)
        if i % 20 == 0:
            cv2.putText(img, str(i), (x - 5, bar_top + bar_h + 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.3, (150, 150, 150), 1)

    cv2.putText(img, f"step_max={step_max:.1f} edge_max={edge_max:.1f}", (2, 35),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (100, 100, 100), 1)

    out_dir = Path(__file__).parent / "输出"
    out_dir.mkdir(exist_ok=True)
    out_path = str(out_dir / "edge_profile.png")
    cv2.imwrite(out_path, img)
    print(f"  Edge profile graph: {out_path}")


def save_annotated(video_path: str, report: dict):
    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, total // 3)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return

    cx, cy = report["hud_center"]["x"], report["hud_center"]["y"]
    colors = [(0,255,0),(255,100,0),(0,200,255),(255,0,200),
              (100,255,100),(255,255,0),(0,100,255),(200,0,255),
              (255,180,0),(0,255,200),(128,255,128),(255,128,0)]

    for ring in report["rings"]:
        rid = ring["ring_id"]
        r = ring["ref_radius"]
        c = colors[rid % len(colors)]
        cv2.circle(frame, (cx, cy), r, c, 1)
        # 标签放在不同角度避免重叠
        ang = rid * 35 + 10
        lx = int(cx + r * np.cos(np.radians(ang)))
        ly = int(cy + r * np.sin(np.radians(ang)))
        label = f"#{rid} r={r}"
        cv2.putText(frame, label, (lx + 3, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (0, 0, 0), 2)
        cv2.putText(frame, label, (lx + 3, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.32, c, 1)

    cv2.drawMarker(frame, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 8, 1)
    out_dir = Path(__file__).parent / "输出"
    out_dir.mkdir(exist_ok=True)
    out_path = str(out_dir / "ring_analysis.png")
    cv2.imwrite(out_path, frame)
    print(f"\n  Annotated: {out_path}")


def main():
    p = argparse.ArgumentParser(description="Concentric ring detector (color gradient + ball mask)")
    p.add_argument("video")
    p.add_argument("--out", "-o", default=None,
                   help="Output JSON path (default: 视频采集数据/输出/ring_analysis.json)")
    p.add_argument("--preview", "-p", action="store_true")
    p.add_argument("--sample-every", "-s", type=int, default=2)
    p.add_argument("--min-prom", type=float, default=1.5)
    p.add_argument("--min-radius", type=int, default=15)
    p.add_argument("--max-radius", type=int, default=130)
    p.add_argument("--center", type=str, default=None, help="Manual center: X,Y")
    args = p.parse_args()

    if not Path(args.video).exists():
        sys.exit(f"Error: {args.video} not found")

    center = None
    if args.center:
        parts = args.center.split(",")
        center = (int(parts[0]), int(parts[1]))

    out_dir = Path(__file__).parent / "输出"
    out_dir.mkdir(exist_ok=True)
    out_json = args.out if args.out else str(out_dir / "ring_analysis.json")

    report = analyze_video(args.video, args.sample_every, args.preview,
                           args.min_prom, args.min_radius, args.max_radius, center)
    print_report(report)
    save_annotated(args.video, report)
    save_edge_profile(report)

    # JSON 导出 (排除内部数据)
    export = {k: v for k, v in report.items() if not k.startswith("_")}
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"  JSON: {out_json}")


if __name__ == "__main__":
    main()
