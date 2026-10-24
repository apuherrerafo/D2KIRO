"""Read-only extractor: pulls a few text files out of Dota 2's multi-part VPK v2. Writes only into the output directory given as argv[2].
usage: python -I vpk_extract.py <dir_vpk> <outdir> <substring> [<substring> ...]"""
import os
import struct
import sys

dir_vpk, outdir, wanted = sys.argv[1], sys.argv[2], sys.argv[3:]
base = dir_vpk[: -len("_dir.vpk")]
with open(dir_vpk, "rb") as f:
    data = f.read()
sig, ver = struct.unpack_from("<II", data, 0)
assert sig == 0x55AA1234 and ver == 2, (hex(sig), ver)
tree_size, file_data_size, md5a, md5b, sigsz = struct.unpack_from("<IIIII", data, 8)
header = 28
tree_end = header + tree_size
data_base = tree_end  # entries stored in the dir file itself (archive index 0x7fff) start here
pos = header


def cstr():
    global pos
    end = data.index(b"\x00", pos)
    s = data[pos:end].decode("utf-8", "replace")
    pos = end + 1
    return s


found = []
while pos < tree_end:
    ext = cstr()
    if ext == "":
        break
    while True:
        path = cstr()
        if path == "":
            break
        while True:
            name = cstr()
            if name == "":
                break
            crc, preload, arch, off, length, term = struct.unpack_from("<IHHIIH", data, pos)
            pos += 18
            pre = data[pos : pos + preload]
            pos += preload
            full = f"{path}/{name}.{ext}" if path != " " else f"{name}.{ext}"
            if ext == "txt" and any(w in full for w in wanted):
                found.append((full, arch, off, length, pre))

os.makedirs(outdir, exist_ok=True)
for full, arch, off, length, pre in found:
    if arch == 0x7FFF:
        body = data[data_base + off : data_base + off + length]
    else:
        with open(f"{base}_{arch:03d}.vpk", "rb") as part:
            part.seek(off)
            body = part.read(length)
    out = os.path.join(outdir, full.replace("/", "__"))
    with open(out, "wb") as fh:
        fh.write(pre + body)
    print(full, len(pre) + len(body))
