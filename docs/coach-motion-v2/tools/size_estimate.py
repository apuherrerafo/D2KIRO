"""production-size-estimate.json: measured bytes / decoded memory of the two clips for A / B / C (+ the WebP prototype), then projections for the full pack
under three architectures. usage: python -I size_estimate.py
Frame counts of the projected clips come from the real loop (BEAT_MS): 41.1 s per full cycle (scenarios 13.1 / 12.9 / 15.1 s); see ASSUMPTIONS."""
import json, sys
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from lib_p2 import S, OUT, WT

MB = 1024 * 1024
dec = json.load(open(f"{S}/ev/decode.json"))
pr = json.load(open(f"{S}/entry/A/meta.json"))
cont = json.load(open(f"{OUT}/continuity-metrics.json"))
FMT = {"A": ("A", 30), "B": ("B", 24), "C": ("C", 30), "webp prototype (q80, 384 px, 30 fps)": ("webp", 30)}

# loop order and the length of each clip at 30 fps (seconds x 30). Loops are 2.0 s ping-pong / 2.4 s hold; transitions are the beat lengths.
CLIPS30 = {"WATCHING_IDLE": (60, "loop"), "WATCHING_TO_ANALYZING": (39, "tr"), "ANALYZING_LOOP": (72, "loop"), "ANALYZING_TO_POINTING": (45, "tr"),
           "POINTING_TO_CONFIRMING": (51, "tr"), "CONFIRMING_TO_POINTING": (45, "tr"), "POINTING_TO_WATCHING": (39, "tr")}
# beat-segment playlist cut from continuous takes: unique segments after de-duplicating the three scenarios (frames at 30 fps)
SEGMENTS30 = {"relax": (39, "tr"), "draft_hold": (54, "loop"), "reveal": (39, "tr"), "E1_ATTRACT": (30, "tr"), "E2_ATTRACT": (30, "tr"), "E3_ATTRACT(s0,s1)": (30, "tr"), "E3_REPEL(s2)": (30, "tr"),
              "E4_TETHER(s0)": (30, "tr"), "E4_absent(s1)": (24, "tr"), "E4_ATTRACT(s2)": (30, "tr"), "E5_ATTRACT(s2)": (30, "tr"), "E6_TETHER(s2)": (30, "tr"),
              "recommendation..carry high (s0,s2)": (141, "tr"), "recommendation..carry medium (s1)": (141, "tr")}

out = {"assumptions": [
    "Measured: the idle (60 / 48 frames) and WATCHING_TO_ANALYZING (39 / 31 frames) atlases of each format, bytes on disk and decoded size (w x h x 4 from the browser's naturalWidth/Height).",
    "Projected: per-frame bytes of the measured idle clip are applied to loop/hold frames and per-frame bytes of the measured transition to every other frame. Content of the other beats is assumed to cost the same per frame.",
    "7-clip pack = WATCHING_IDLE 60, W->A 39, ANALYZING_LOOP 72, A->P 45, P->C 51, C->P 45, P->W 39 frames at 30 fps (24 fps: x0.8). The real loop order is WATCHING -> ANALYZING -> POINTING -> CONFIRMING -> POINTING -> WATCHING.",
    "Decoded memory is an upper-bound model (w x h x 4 per decoded atlas); the browser may hold extra copies. Not measured on a phone.",
    "Download size = bytes, no HTTP compression gain expected (AVIF/WebP are already compressed)."], "formats": {}}


def per_frame(pack, fps_scale):
    i, t = dec[f"{pack}/WATCHING_IDLE"], dec[f"{pack}/WATCHING_TO_ANALYZING"]
    fi = 60 * fps_scale if False else (60 if fps_scale == 1 else 48)
    ft = 39 if fps_scale == 1 else 31
    return dict(idle_bytes=i["bytes"], trans_bytes=t["bytes"], idle_b_per_frame=i["bytes"] / fi, trans_b_per_frame=t["bytes"] / ft, idle_dec=i["decodedBytes"], trans_dec=t["decodedBytes"],
                idle_dec_per_frame=i["decodedBytes"] / fi, trans_dec_per_frame=t["decodedBytes"] / ft, idle_frames=fi, trans_frames=ft,
                idle_decode_ms=sorted(i["ms"])[1], trans_decode_ms=sorted(t["ms"])[1])


for name, (pack, fps) in FMT.items():
    k = 1 if fps == 30 else 0.8
    m = per_frame(pack, k)
    f = dict(fps=fps, measured=dict(idle_bytes=m["idle_bytes"], transition_bytes=m["trans_bytes"], idle_plus_transition_bytes=m["idle_bytes"] + m["trans_bytes"],
                                    idle_decoded_MB=round(m["idle_dec"] / MB, 2), transition_decoded_MB=round(m["trans_dec"] / MB, 2),
                                    current_plus_next_decoded_MB_idle_to_transition=round((m["idle_dec"] + m["trans_dec"]) / MB, 2),
                                    bytes_per_frame=dict(idle=round(m["idle_b_per_frame"]), transition=round(m["trans_b_per_frame"])), cold_decode_ms_median_desktop_gpu=dict(idle=m["idle_decode_ms"], transition=m["trans_decode_ms"])))

    def sized(table):
        rows = {}
        for cid, (n30, kind) in table.items():
            n = max(1, round(n30 * k))
            b = n * (m["idle_b_per_frame"] if kind == "loop" else m["trans_b_per_frame"])
            d = n * (m["idle_dec_per_frame"] if kind == "loop" else m["trans_dec_per_frame"])
            rows[cid] = dict(frames=n, bytes=round(b), decoded_MB=round(d / MB, 2))
        return rows

    seven = sized(CLIPS30)
    order = list(seven)
    pairs = {f"{order[i]} + {order[(i + 1) % len(order)]}": round(seven[order[i]]["decoded_MB"] + seven[order[(i + 1) % len(order)]]["decoded_MB"], 2) for i in range(len(order))}
    a1 = dict(clips=seven, total_bytes=sum(r["bytes"] for r in seven.values()), total_frames=sum(r["frames"] for r in seven.values()), all_decoded_at_once_MB=round(sum(r["decoded_MB"] for r in seven.values()), 1),
              peak_current_plus_next_MB=max(pairs.values()), worst_pair=max(pairs, key=pairs.get), assets=len(seven))
    # entry heads: heads are 5 frames (0..4) of the rebased transition; the tail replaces frames 5.. of the canonical clip; two loop-exit boundaries (idle, analyzing hold)
    arch2 = {}
    for stride, nheads in ((12, 6), (6, 11)):
        extra_frames = 2 * (nheads * 5 - 5)
        extra_bytes = 2 * (nheads * 5 - 5) * m["trans_b_per_frame"] * (1 if True else 0)
        # decoded NEXT at a loop exit = tail + up to 3 neighbour heads (measured in the lab)
        tail_dec = (39 * k - 5 * k) * m["trans_dec_per_frame"]
        head_dec = 3 * 5 * k * m["trans_dec_per_frame"] * (1.0 if fps == 30 else 1.0)
        loop_dec = max(seven["WATCHING_IDLE"]["decoded_MB"], seven["ANALYZING_LOOP"]["decoded_MB"]) * MB
        arch2[f"stride{stride}"] = dict(heads_per_boundary=nheads, assets=a1["assets"] + 2 * nheads, extra_frames=round(extra_frames), total_bytes=round(a1["total_bytes"] + extra_bytes),
                                        peak_current_plus_next_MB=round(max(a1["peak_current_plus_next_MB"], (loop_dec + tail_dec + head_dec) / MB), 1))
    seg = sized(SEGMENTS30)
    chunk_frames = int(round(fps))   # 1 s chunks: CURRENT + NEXT = 2 s of frames
    per_frame_dec = m["trans_dec_per_frame"]
    arch3 = dict(segments=seg, total_frames=sum(r["frames"] for r in seg.values()), total_bytes=sum(r["bytes"] for r in seg.values()), assets_unsliced=len(seg),
                 peak_current_plus_next_MB_if_sliced_in_1s_chunks=round(2 * chunk_frames * per_frame_dec / MB, 1),
                 peak_current_plus_next_MB_largest_unsliced_pair=round(max(seg[a]["decoded_MB"] + seg[b]["decoded_MB"] for a, b in zip(list(seg), list(seg)[1:])), 1))
    f["projected_full_pack"] = {"A1_seven_clips_canonical_entries": a1, "A2_seven_clips_plus_entry_heads": arch2, "A3_continuous_beat_segments": arch3}
    out["formats"][name] = f

out["measured_in_lab_loader_model"] = {k: dict(peak_decoded_MB=round(v["peakDecodedBytes"] / MB, 1), held_at_end=v["heldAtEnd"], decoded_MB_at_end=round(v["bytesAtEnd"] / MB, 1)) for k, v in pr["memory"].items()}
out["measured_in_lab_loader_model_note"] = ("pack A, cue at idle frame 30, one strategy owns the loader: CURRENT idle decoded + NEXT prefetched, idle released after the hand-over (decoded_MB_at_end shows only NEXT left). "
                                           "nearest/wait peak includes the heads run() pre-warms (phases 0,6,12) on top of the sliding window; the model figure in A2 (stride 12) is the tighter number.")
out["boundary_quality_summary_pack_A"] = {k: dict(mad=v["mad"], centroid_px=v["centroid_px"], ring_px=v["ring_px"], visor_px=v["visor_px"], waits_ms_max=v["latency_ms_max"]) for k, v in cont["sweep_all_idle_phases"].items() if k in ("canonical", "nearest_stride6", "nearest_stride12", "wait_stride6", "wait_stride12")}
json.dump(out, open(f"{OUT}/production-size-estimate.json", "w"), indent=1)
for n, f in out["formats"].items():
    p = f["projected_full_pack"]
    print(n, "| measured idle+trans", f["measured"]["idle_plus_transition_bytes"], "| A1", p["A1_seven_clips_canonical_entries"]["total_bytes"], "peak", p["A1_seven_clips_canonical_entries"]["peak_current_plus_next_MB"],
          "| A2 s12", p["A2_seven_clips_plus_entry_heads"]["stride12"]["total_bytes"], "| A3", p["A3_continuous_beat_segments"]["total_bytes"], p["A3_continuous_beat_segments"]["peak_current_plus_next_MB_if_sliced_in_1s_chunks"])
