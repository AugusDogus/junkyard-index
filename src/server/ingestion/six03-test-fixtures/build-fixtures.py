"""Rebuild checked-in fixtures from the frozen local captures, without HTTP.

Run from the repository root. The capture directory is intentionally not a test
dependency. Full source and exact retained-fragment hashes make minimization
reviewable without copying 368 MB of provider chrome into the repository.
"""

import gzip
import hashlib
import json
import re
from pathlib import Path


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def native(path):
    # read_text() would normalize CRLF and invalidate the source byte pin.
    return path.read_bytes().decode("utf-8")


def compressed(path, raw):
    path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))


base = Path(".scratchpad/coverage/parallel-me-nh-vt/603-finite-census11")
saved = Path(".scratchpad/coverage/new-leads/twelfth-wave")
out = Path(__file__).resolve().parent
captures = json.loads((base / "captures.json").read_bytes())
entries = []
for capture in captures:
    source = Path(capture["body"]["file"])
    assert digest(source.read_bytes()) == capture["body"]["sha256"]
    entries.append((capture["url"], source))
for name in ["603-civic-donor.html", "603-tacoma-donor.html"]:
    source = saved / name
    url = re.search(r'rel="canonical" href="([^"]+)"', native(source))[1]
    entries.append((url, source))

details, pins = [], []
for url, source in entries:
    raw = source.read_bytes()
    html = raw.decode("utf-8")
    main = re.search(r"<main\b[^>]*>.*?</main\s*>", html, re.S)[0]
    canonical = re.search(r'<link[^>]*rel="canonical"[^>]*>', html)[0]
    title = re.search(r"<title>.*?</title>", html, re.S)[0]
    phone = next(
        match[0]
        for match in re.finditer(r'''<a\b[^>]*href=["']tel:[^"']+["'][^>]*>.*?</a>''', html, re.S)
        if re.sub(r"\D", "", match[0].split(">")[0]) == "6033927313"
    )
    fixture = "<html><head>" + title + canonical + "</head><body>" + main + phone + "</body></html>"
    details.append([url.removeprefix("https://603autosalvage.com"), fixture])
    pins.append({"url": url, "sourceBytes": len(raw), "sourceSHA256": digest(raw),
                 "nativeMainSHA256": digest(main.encode()), "fixtureSHA256": digest(fixture.encode())})

catalog = saved / "603-parts-vehicles.html"
contact = Path(".scratchpad/coverage/parallel-me-nh-vt/603-contact-native13/body.raw")
fixture = {"catalog": native(catalog), "contact": native(contact), "details": details}
compressed(out / "native-census.json.gz", json.dumps(fixture, ensure_ascii=False, separators=(",", ":")).encode())
jeep = Path(".scratchpad/coverage/new-leads/nh603-jeep-control.html").read_bytes()
compressed(out / "jeep-native.html.gz", jeep)
oracle_path = Path(".scratchpad/coverage/parallel-ma-ct-ri/603-canonical-oracle01/canonical-oracle.json")
oracle = oracle_path.read_bytes()
assert digest(oracle) == "45f05e4469928cfd2e02f5bda8fea472c96430aacb81fb5bd1f8dd2194fb20cb"
compressed(out / "independent-oracle.json.gz", oracle)
manifest = {
    "provenance": "Saved-only native corpus. Catalog and contact preserve complete raw UTF-8 bytes. Detail fixtures retain the exact native main, title, canonical link and a native telephone anchor, with a document wrapper. No donor field is synthesized.",
    "catalog": {"sha256": digest(catalog.read_bytes()), "bytes": catalog.stat().st_size},
    "contact": {"sha256": digest(contact.read_bytes()), "bytes": contact.stat().st_size},
    "nativeControls": 1033, "embeddedExcerptDonors": 10, "detailDonors": 1023,
    "details": pins,
    "additionalNativeExample": {"file": "jeep-native.html.gz", "bytes": len(jeep), "sha256": digest(jeep)},
    "independentCanonicalOracle": {"source": str(oracle_path), "bytes": len(oracle), "sha256": digest(oracle),
                                   "vehicles": 973, "fieldsPerVehicle": 25, "canonicalValues": 24325,
                                   "authority": "Independent Python/lxml reparse of the saved native corpus, without app parser or transform imports."},
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"details": len(details), "compressedBytes": (out / "native-census.json.gz").stat().st_size,
                  "catalogSHA256": digest(catalog.read_bytes()), "oracleSHA256": digest(oracle)}))
