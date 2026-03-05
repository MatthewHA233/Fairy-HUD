"""
生成 HUD 帧动画视频 — 复刻参考视频的颜色布局和脉动
用法: python generate_video.py [--preview]
输出: generated_hud.mp4
"""
import cv2
import numpy as np
import json
import argparse
from pathlib import Path


def extract_radial_profile(video_path: str, cx: int, cy: int, max_r: int,
                           H: int, W: int, sample_every: int = 5) -> np.ndarray:
    """从参考视频提取平均径向 BGR 颜色剖面 (bincount 向量化)"""
    cap = cv2.VideoCapture(video_path)

    ys, xs = np.mgrid[0:H, 0:W]
    dist = np.sqrt((xs.astype(np.float64) - cx) ** 2 + (ys.astype(np.float64) - cy) ** 2)
    dist_int = np.clip(dist.astype(int), 0, max_r - 1).ravel()

    counts = np.bincount(dist_int, minlength=max_r).astype(np.float64)
    sum_bgr = np.zeros((max_r, 3), dtype=np.float64)
    n = 0
    fidx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fidx % sample_every == 0:
            for ch in range(3):
                flat = frame[:, :, ch].ravel().astype(np.float64)
                sum_bgr[:, ch] += np.bincount(dist_int, weights=flat, minlength=max_r)
            n += 1
        fidx += 1

    cap.release()

    total_counts = counts * max(n, 1)
    nz = total_counts > 0
    for ch in range(3):
        sum_bgr[nz, ch] /= total_counts[nz]

    # 轻度平滑
    kernel = np.array([1, 2, 4, 2, 1], dtype=np.float64)
    kernel /= kernel.sum()
    for ch in range(3):
        sum_bgr[:, ch] = np.convolve(sum_bgr[:, ch], kernel, mode="same")

    return sum_bgr


def get_radius_at_frame(ring: dict, fidx: int, sample_every: int = 2) -> float:
    """插值获取某帧的环半径"""
    tl = ring["timeline"]
    if not tl:
        return float(ring["ref_radius"])
    t = fidx / sample_every
    i = int(t)
    frac = t - i
    if i >= len(tl) - 1:
        return float(tl[-1])
    if i < 0:
        return float(tl[0])
    return tl[i] * (1.0 - frac) + tl[i + 1] * frac


def build_warp(ref_radii: list, cur_radii: list, max_r: int) -> np.ndarray:
    """分段线性径向变换: output_radius -> source_radius"""
    ref_pts = np.array([0.0] + ref_radii + [float(max_r)])
    cur_pts = np.array([0.0] + cur_radii + [float(max_r)])
    r_out = np.arange(max_r, dtype=np.float64)
    return np.interp(r_out, cur_pts, ref_pts)


def render_frame(dist_flat: np.ndarray, profile: np.ndarray,
                 warp: np.ndarray, max_r: int, shape: tuple) -> np.ndarray:
    """向量化渲染一帧"""
    H, W = shape
    d_clip = np.clip(dist_flat, 0, max_r - 1.001).astype(int)

    src_r = warp[d_clip]
    src_r = np.clip(src_r, 0, max_r - 1.001)
    src_int = src_r.astype(int)
    src_frac = src_r - src_int
    next_int = np.minimum(src_int + 1, max_r - 1)

    frame = np.zeros((H * W, 3), dtype=np.uint8)
    for ch in range(3):
        c0 = profile[src_int, ch]
        c1 = profile[next_int, ch]
        frame[:, ch] = np.clip(c0 + (c1 - c0) * src_frac, 0, 255).astype(np.uint8)

    return frame.reshape(H, W, 3)


def add_gyro_gradient(frame: np.ndarray, theta_map: np.ndarray,
                      dist_map: np.ndarray, gyro_angle: float) -> np.ndarray:
    """陀螺仪: 在环区域添加旋转角度亮度梯度"""
    diff = theta_map - gyro_angle
    grad = 0.5 + 0.5 * np.cos(diff)  # 0..1

    # 只影响 r=55..100 的环区域 (白环外侧到薄环)
    r_mask = (dist_map > 55) & (dist_map < 100)
    factor = np.ones_like(dist_map, dtype=np.float32)
    factor[r_mask] = 0.80 + 0.20 * grad[r_mask]

    result = frame.astype(np.float32)
    for ch in range(3):
        result[:, :, ch] *= factor
    return np.clip(result, 0, 255).astype(np.uint8)


def add_glow(frame: np.ndarray, strength: float = 0.4) -> np.ndarray:
    """辉光 bloom 效果"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, bright = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    mask3 = cv2.merge([bright, bright, bright]).astype(np.float32) / 255.0

    glow = cv2.GaussianBlur(frame, (0, 0), sigmaX=20, sigmaY=20)
    glow = (glow.astype(np.float32) * mask3).astype(np.uint8)

    return cv2.addWeighted(frame, 1.0, glow, strength, 0)


def add_ball(frame: np.ndarray, cx: int, cy: int, angle: float,
             radius: float = 43) -> np.ndarray:
    """白色小球 + 辉光"""
    bx = int(cx + radius * np.cos(angle))
    by = int(cy + radius * np.sin(angle))

    # 外层辉光
    overlay = frame.copy()
    cv2.circle(overlay, (bx, by), 11, (170, 170, 200), -1)
    frame = cv2.addWeighted(frame, 0.8, overlay, 0.2, 0)

    # 内核
    cv2.circle(frame, (bx, by), 4, (255, 255, 255), -1)
    return frame


def main():
    parser = argparse.ArgumentParser(description="Generate HUD animation video")
    parser.add_argument("--preview", "-p", action="store_true")
    parser.add_argument("--out", "-o", default="generated_hud.mp4")
    args = parser.parse_args()

    with open("ring_analysis.json", encoding="utf-8") as f:
        data = json.load(f)

    cx = data["hud_center"]["x"]
    cy = data["hud_center"]["y"]
    rings = data["rings"]
    W = data["video"]["width"]
    H = data["video"]["height"]
    fps = data["video"]["fps"]
    total = data["video"]["total_frames"]
    max_r = min(W, H) // 2

    ref_radii = [float(r["ref_radius"]) for r in rings]
    video_path = "public/参考视频.mp4"

    # ── Step 1: 提取颜色剖面 ──
    print("Step 1: Extracting radial color profile from reference...")
    profile = extract_radial_profile(video_path, cx, cy, max_r, H, W, sample_every=5)
    print(f"  Done. Profile shape: {profile.shape}")

    # ── Step 2: 预计算 ──
    print("Step 2: Precomputing maps...")
    ys, xs = np.mgrid[0:H, 0:W]
    dist_map = np.sqrt((xs.astype(np.float64) - cx) ** 2 +
                       (ys.astype(np.float64) - cy) ** 2)
    dist_flat = dist_map.ravel()
    theta_map = np.arctan2(ys.astype(np.float64) - cy,
                           xs.astype(np.float64) - cx).astype(np.float32)

    # ── Step 3: 逐帧渲染 ──
    print(f"Step 3: Rendering {total} frames @ {fps}fps...")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(args.out, fourcc, fps, (W, H))

    for fidx in range(total):
        t = fidx / fps

        # 3a. 当前环半径
        cur_radii = [get_radius_at_frame(r, fidx) for r in rings]

        # 3b. 径向变换
        warp = build_warp(ref_radii, cur_radii, max_r)

        # 3c. 基础渲染
        frame = render_frame(dist_flat, profile, warp, max_r, (H, W))

        # 3d. 陀螺仪旋转梯度 (~0.5°/frame = 30°/s)
        gyro_angle = t * np.radians(30)
        frame = add_gyro_gradient(frame, theta_map, dist_map, gyro_angle)

        # 3e. 辉光
        frame = add_glow(frame, 0.35)

        # 3f. 小球 (135° 附近摆动 ±18°)
        ball_angle = np.radians(135) + np.sin(t * 1.2) * np.radians(18)
        frame = add_ball(frame, cx, cy, ball_angle, radius=43)

        out.write(frame)

        if args.preview:
            cv2.imshow("Generated HUD [q=quit]", frame)
            if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                break

        if fidx % 60 == 0:
            print(f"  frame {fidx}/{total}")

    out.release()
    if args.preview:
        cv2.destroyAllWindows()

    print(f"\nDone! Output: {args.out}")
    print(f"  {W}x{H} @ {fps}fps, {total} frames ({total / fps:.1f}s)")


if __name__ == "__main__":
    main()
