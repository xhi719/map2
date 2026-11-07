"""Snap the coarse 1938 country polygons to the Natural Earth 50m coastline.

Each country is grown by ~20 km into unclaimed space (never into a neighbour)
and then cut by the land mask, so country fills and overlay clips line up
exactly with the drawn coastline.

    python3 tools/fit-borders.py      (run after tools/prepare-geo.mjs)
"""
import json
import pathlib

from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "geo-data.js"
text = SRC.read_text(encoding="utf8")
head, body = text.split("window.GEO=", 1)
geo = json.loads(body.rstrip().rstrip(";"))


def to_shape(polys):
    out = []
    for p in polys:
        try:
            out.append(make_valid(Polygon(p[0], p[1:])))
        except Exception:
            pass
    return unary_union(out)


def to_polys(shape):
    shape = shape.simplify(0.015, preserve_topology=True)
    geoms = [shape] if isinstance(shape, Polygon) else list(getattr(shape, "geoms", []))
    res = []
    for g in geoms:
        if not isinstance(g, Polygon) or g.area < 0.003:
            continue
        g = orient(g, -1.0)  # clockwise exterior: d3-geo spherical convention
        rings = [list(g.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in g.interiors if Polygon(r).area > 0.003]
        res.append([[[round(x, 2), round(y, 2)] for x, y in r] for r in rings])
    return res


land = to_shape(geo["land"]).buffer(0)
shapes = {k: to_shape(v) for k, v in geo["countries"].items()}
fitted = {}
for name, shp in shapes.items():
    others = unary_union([s for k, s in shapes.items() if k != name and s.envelope.intersects(shp.buffer(0.5).envelope)])
    grown = shp.buffer(0.2, join_style=2).difference(others.buffer(0)).buffer(0)
    fitted[name] = to_polys(make_valid(grown.intersection(land)))

geo["countries"] = {k: v for k, v in fitted.items() if v}
geo["owner"] = {k: geo["owner"].get(k, k) for k in geo["countries"]}
SRC.write_text(head + "window.GEO=" + json.dumps(geo, separators=(",", ":")) + ";\n", encoding="utf8")
print("fitted", len(geo["countries"]), "countries;", round(SRC.stat().st_size / 1024), "KB")
