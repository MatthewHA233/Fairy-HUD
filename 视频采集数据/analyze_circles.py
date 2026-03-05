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
    """BGR 三通道径向剖面, 可选遮罩掉小球"""
    h, w = frame.shape[:2]
    profiles = np.zeros((3, max_r), dtype=np.float64)
    counts = np.zeros(max_r, dtype=np.float64)

    angles = np.linspace(0, 2 * np.pi, num_angles, endpoint=False)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)

    for r in range(max_r):
        xs = (cx + r * cos_a).astype(int)
        ys = (cy + r * sin_a).astype(int)
        valid = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)

        vx = xs[valid]
        vy = ys[valid]

        if ball_mask is not None:
            # 排除小球区域的采样点
            not_ball = ball_mask[vy, vx] > 0
            vx = vx[not_ball]
            vy = vy[not_ball]

        if len(vx) == 0:
            continue

        pixels = frame[vy, vx]
        profiles[0, r] = np.mean(pixels[:, 0])
        profiles[1, r] = np.mean(pixels[:, 1])
        profiles[2, r] = np.mean(pixels[:, 2])
        counts[r] = len(vx)

    return profiles[0], profiles[1], profiles[2]


def compute_edge_profile(b: np.ndarray, g: np.ndarray, r: np.ndarray) -> np.ndarray:
    """三通道梯度合成边缘强度"""
    k = np.array([1, 2, 3, 2, 1], dtype=np.float64)
    k /= k.sum()

    bs = np.convolve(b, k, mode='same')
    gs = np.convolve(g, k, mode='same')
    rs = np.convolve(r, k, mode='same')

    bg = np.abs(np.gradient(bs))
    gg = np.abs(np.gradient(gs))
    rg = np.abs(np.gradient(rs))

    # 亮度梯度: 各通道最大值
    lum_edge = np.maximum(np.maximum(bg, gg), rg)

    # 色彩梯度: 通道差的变化
    bg_d = np.abs(np.gradient(np.convolve(np.abs(bs - gs), k, mode='same')))
    br_d = np.abs(np.gradient(np.convolve(np.abs(bs - rs), k, mode='same')))
    gr_d = np.abs(np.gradient(np.convolve(np.abs(gs - rs), k, mode='same')))
    color_edge = np.maximum(np.maximum(bg_d, br_d), gr_d)

    return lum_edge + color_edge * 0.8


def find_edge_peaks(profile: np.ndarray, min_prom: float = 2.0, min_dist: int = 3, skip: int = 3) -> list[dict]:
    data = profile.copy()
    data[:skip] = 0
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


def describe_boundary(bp, gp, rp, radius):
    inner = max(0, radius - 3)
    outer = min(len(bp) - 1, radius + 3)
    return f"{color_name(bp[inner], gp[inner], rp[inner])} -> {color_name(bp[outer], gp[outer], rp[outer])}"


def analyze_video(video_path: str, sample_every: int = 2, preview: bool = False,
                  min_prom: float = 2.5, center: tuple[int, int] | None = None) -> dict:
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

    # ── Pass 1: 平均边缘剖面 ──
    print("\n  Pass 1: Average edge profile (with ball masked)...")
    avg_edge = np.zeros(max_r, dtype=np.float64)
    avg_b = np.zeros(max_r, dtype=np.float64)
    avg_g = np.zeros(max_r, dtype=np.float64)
    avg_r_ch = np.zeros(max_r, dtype=np.float64)
    n_frames = 0
    fidx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fidx % sample_every == 0:
            # 每帧更新小球遮罩 (球会动)
            bm = create_ball_mask(frame, cx, cy, max_r)
            bp, gp, rp = radial_profiles_bgr(frame, cx, cy, max_r, ball_mask=bm, num_angles=180)
            edge = compute_edge_profile(bp, gp, rp)
            avg_edge += edge
            avg_b += bp
            avg_g += gp
            avg_r_ch += rp
            n_frames += 1
        fidx += 1

    avg_edge /= max(n_frames, 1)
    avg_b /= max(n_frames, 1)
    avg_g /= max(n_frames, 1)
    avg_r_ch /= max(n_frames, 1)

    rings = find_edge_peaks(avg_edge, min_prom, min_dist=3)
    print(f"  Found {len(rings)} color boundaries:\n")

    tracks = {}
    for i, ring in enumerate(rings):
        r = ring["radius"]
        bd = describe_boundary(avg_b, avg_g, avg_r_ch, r)
        ring["boundary"] = bd
        ring["id"] = i
        tracks[i] = {"id": i, "ref_r": r, "boundary": bd, "strength": ring["edge_strength"], "samples": []}
        print(f"    #{i:>2}  r={r:>3}px  edge={ring['edge_strength']:>5.1f}  {bd}")

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
            summaries.append({
                "ring_id": tid, "ref_radius": t["ref_r"], "boundary": t["boundary"],
                "edge_strength": round(t["strength"], 1), "frames": len(samps),
                "motion": "insufficient data",
                "radius_avg": float(t["ref_r"]), "radius_min": t["ref_r"],
                "radius_max": t["ref_r"], "radius_change": 0, "timeline": [],
            })
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

        summaries.append({
            "ring_id": tid, "ref_radius": t["ref_r"], "boundary": t["boundary"],
            "edge_strength": round(t["strength"], 1),
            "radius_avg": round(r_avg, 1), "radius_min": r_min, "radius_max": r_max,
            "radius_change": r_change, "frames": len(samps),
            "motion": motion, "timeline": radii[:200],
        })

    summaries.sort(key=lambda s: s["ref_radius"])

    return {
        "video": {"path": video_path, "width": w, "height": h,
                  "fps": round(fps, 2), "total_frames": total,
                  "duration_s": round(total / fps, 2) if fps > 0 else 0},
        "hud_center": {"x": cx, "y": cy},
        "rings": summaries,
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
    print(f"\n  {'#':>3} {'R(px)':>6} {'Range':>10} {'Edge':>5} {'Frames':>6} {'Boundary':30} {'Motion'}")
    print(f"  " + "-" * 95)
    for r in rings:
        rng = f"{r['radius_min']}-{r['radius_max']}" if r['radius_change'] > 0 else "---"
        print(f"  {r['ring_id']:>3} {r['ref_radius']:>5} {rng:>10} {r['edge_strength']:>5.1f} {r['frames']:>6} {r['boundary']:30} {r['motion']}")

    max_r = max((r["ref_radius"] for r in rings), default=1)
    print(f"\n  Layout (center -> out):")
    for r in rings:
        bar = "=" * int(r["ref_radius"] / max_r * 50)
        ch = f" [{r['radius_min']}-{r['radius_max']}]" if r['radius_change'] > 1 else ""
        print(f"  {r['ref_radius']:>4}px {bar}| {r['motion']}{ch}")


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
        ang = rid * 28 + 10
        lx = int(cx + r * np.cos(np.radians(ang)))
        ly = int(cy + r * np.sin(np.radians(ang)))
        cv2.putText(frame, f"#{rid} r={r}", (lx+3, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.3, c, 1)

    cv2.drawMarker(frame, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 8, 1)
    cv2.imwrite("ring_analysis.png", frame)
    print(f"\n  Annotated: ring_analysis.png")


def main():
    p = argparse.ArgumentParser(description="Concentric ring detector (color gradient + ball mask)")
    p.add_argument("video")
    p.add_argument("--out", "-o", default="ring_analysis.json")
    p.add_argument("--preview", "-p", action="store_true")
    p.add_argument("--sample-every", "-s", type=int, default=2)
    p.add_argument("--min-prom", type=float, default=2.5)
    p.add_argument("--center", type=str, default=None, help="Manual center: X,Y")
    args = p.parse_args()

    if not Path(args.video).exists():
        sys.exit(f"Error: {args.video} not found")

    center = None
    if args.center:
        parts = args.center.split(",")
        center = (int(parts[0]), int(parts[1]))

    report = analyze_video(args.video, args.sample_every, args.preview, args.min_prom, center)
    print_report(report)
    save_annotated(args.video, report)

    export = {k: v for k, v in report.items()}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"  JSON: {args.out}")


if __name__ == "__main__":
    main()
