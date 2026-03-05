"""
生成 HUD 帧动画视频 — 纯数据驱动
所有颜色、半径、脉动全部来自 ring_analysis JSON，无任何硬编码元素。
用法: python generate_video.py [--preview] [--out OUTPUT] [--data JSON] [--fps FPS]
"""
import cv2
import numpy as np
import json
import argparse
import re
from pathlib import Path


def parse_boundary_colors(boundary_str: str) -> tuple:
    """
    解析边界颜色字符串 "name(B,G,R) -> name(B,G,R)"
    返回 ((B_inner, G_inner, R_inner), (B_outer, G_outer, R_outer))
    """
    nums = re.findall(r'\((\d+),(\d+),(\d+)\)', boundary_str)
    if len(nums) >= 2:
        inner = tuple(float(x) for x in nums[0])  # (B, G, R)
        outer = tuple(float(x) for x in nums[1])
        return inner, outer
    if len(nums) == 1:
        c = tuple(float(x) for x in nums[0])
        return c, c
    return (0, 0, 0), (0, 0, 0)


def build_color_profile(rings: list, max_r: int) -> np.ndarray:
    """
    从分界线颜色构建径向 BGR 颜色剖面 (max_r, 3)
    在相邻分界线之间线性插值
    """
    # 收集颜色锚点: [(radius, BGR), ...]
    stops = [(0, np.array([0, 0, 0], dtype=np.float64))]  # 中心=黑

    for ring in sorted(rings, key=lambda r: r["ref_radius"]):
        inner_bgr, outer_bgr = parse_boundary_colors(ring["boundary"])
        r = ring["ref_radius"]
        # 分界线内侧颜色 (r - 0.5) 和外侧颜色 (r + 0.5)
        stops.append((max(r - 1, 0), np.array(inner_bgr, dtype=np.float64)))
        stops.append((r + 1, np.array(outer_bgr, dtype=np.float64)))

    # 末尾延伸到 max_r
    if stops:
        stops.append((max_r, stops[-1][1].copy()))

    # 去重并排序
    stops.sort(key=lambda s: s[0])

    # 线性插值生成完整剖面
    profile = np.zeros((max_r, 3), dtype=np.float64)
    for ri in range(max_r):
        # 找 ri 落在哪两个 stop 之间
        left_idx = 0
        for si in range(len(stops) - 1):
            if stops[si][0] <= ri:
                left_idx = si
        right_idx = min(left_idx + 1, len(stops) - 1)

        r_left, c_left = stops[left_idx]
        r_right, c_right = stops[right_idx]

        if r_right == r_left:
            profile[ri] = c_left
        else:
            t = (ri - r_left) / (r_right - r_left)
            t = max(0.0, min(1.0, t))
            profile[ri] = c_left * (1 - t) + c_right * t

    return profile


def get_radius_at_frame(ring: dict, fidx: int) -> float:
    """直接取帧对应的环半径"""
    tl = ring["timeline"]
    if not tl:
        return float(ring["ref_radius"])
    if fidx >= len(tl):
        return float(tl[-1])
    return float(tl[fidx])


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


def main():
    parser = argparse.ArgumentParser(description="Generate HUD animation video (data-driven)")
    parser.add_argument("--preview", "-p", action="store_true")
    default_out = str(Path(__file__).parent / "输出" / "generated_hud.mp4")
    default_data = str(Path(__file__).parent / "输出" / "ring_analysis.json")
    parser.add_argument("--out", "-o", default=default_out)
    parser.add_argument("--data", "-d", default=default_data,
                        help="Ring analysis JSON file")
    parser.add_argument("--fps", type=float, default=None,
                        help="Override output FPS (default: use source fps)")
    parser.add_argument("--width", type=int, default=None,
                        help="Override output width (default: use source)")
    parser.add_argument("--height", type=int, default=None,
                        help="Override output height (default: use source)")
    args = parser.parse_args()

    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)

    cx = data["hud_center"]["x"]
    cy = data["hud_center"]["y"]
    rings = data["rings"]
    src_fps = data["video"]["fps"]
    total = data["video"]["total_frames"]
    src_w = data["video"]["width"]
    src_h = data["video"]["height"]

    # 输出尺寸和帧率
    out_fps = args.fps if args.fps else src_fps
    out_w = args.width if args.width else src_w
    out_h = args.height if args.height else src_h

    # 如果输出尺寸和源不同, 按比例缩放中心和半径
    scale_x = out_w / src_w
    scale_y = out_h / src_h
    out_cx = int(cx * scale_x)
    out_cy = int(cy * scale_y)
    scale_r = min(scale_x, scale_y)  # 半径用较小的缩放

    max_r = min(out_w, out_h) // 2

    print(f"Source: {src_w}x{src_h} @ {src_fps}fps, {total} frames")
    print(f"Output: {out_w}x{out_h} @ {out_fps}fps, center=({out_cx},{out_cy})")
    print(f"  Scale: {scale_r:.2f}x, max_r: {max_r}")
    print(f"  Rings: {len(rings)}")

    # ── Step 1: 从 JSON 颜色数据构建径向颜色剖面 ──
    print("\nStep 1: Building radial color profile from JSON boundary colors...")

    # 缩放 ring 半径
    scaled_rings = []
    for r in rings:
        sr = dict(r)
        sr["ref_radius"] = round(r["ref_radius"] * scale_r)
        sr["timeline"] = [round(v * scale_r) for v in r.get("timeline", [])]
        scaled_rings.append(sr)

    profile = build_color_profile(scaled_rings, max_r)
    print(f"  Profile shape: {profile.shape}")

    # ref_radii 用于 warp
    ref_radii = [float(r["ref_radius"]) for r in scaled_rings]

    # ── Step 2: 预计算距离图 ──
    print("Step 2: Precomputing distance map...")
    ys, xs = np.mgrid[0:out_h, 0:out_w]
    dist_map = np.sqrt((xs.astype(np.float64) - out_cx) ** 2 +
                       (ys.astype(np.float64) - out_cy) ** 2)
    dist_flat = dist_map.ravel()

    # ── Step 3: 逐帧渲染 ──
    # 如果输出帧率和源不同, 需要插值 timeline
    if out_fps != src_fps:
        out_total = int(total * out_fps / src_fps)
    else:
        out_total = total

    print(f"Step 3: Rendering {out_total} frames @ {out_fps}fps...")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(args.out, fourcc, out_fps, (out_w, out_h))

    for fidx in range(out_total):
        # 源帧索引 (用于 timeline 查询)
        src_fidx = fidx * src_fps / out_fps if out_fps != src_fps else fidx
        src_i = int(src_fidx)
        src_frac = src_fidx - src_i

        # 当前环半径 (支持插值)
        cur_radii = []
        for r in scaled_rings:
            tl = r["timeline"]
            if not tl:
                cur_radii.append(float(r["ref_radius"]))
            elif src_i >= len(tl) - 1:
                cur_radii.append(float(tl[-1]))
            else:
                v = tl[src_i] * (1.0 - src_frac) + tl[src_i + 1] * src_frac
                cur_radii.append(v)

        # 径向变换
        warp = build_warp(ref_radii, cur_radii, max_r)

        # 渲染
        frame = render_frame(dist_flat, profile, warp, max_r, (out_h, out_w))

        out.write(frame)

        if args.preview:
            show = frame
            if out_w > 800:
                show = cv2.resize(frame, (out_w // 2, out_h // 2))
            cv2.imshow("Generated HUD [q=quit]", show)
            if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                break

        if fidx % max(1, int(out_fps)) == 0:
            print(f"  frame {fidx}/{out_total}")

    out.release()
    if args.preview:
        cv2.destroyAllWindows()

    print(f"\nDone! Output: {args.out}")
    print(f"  {out_w}x{out_h} @ {out_fps}fps, {out_total} frames ({out_total/out_fps:.1f}s)")


if __name__ == "__main__":
    main()
