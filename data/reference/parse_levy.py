import re
lines = open(__import__('pathlib').Path(__file__).with_name('gallatin_2025_mill_levy.txt')).read().splitlines()
start = next(i for i,l in enumerate(lines) if 'CONSOLIDATED Levy Districts' in l)
rows = []
pat = re.compile(r'^(0\d-[0-9A-Z]{4,8})\**\s+(.*?)\s+(City|Rural)\s+(.*)$')
for l in lines[start:]:
    s = l.strip()
    m = pat.match(s) if s else None
    if not m: continue
    code, cityrural, rest = m.group(1), m.group(3), m.group(4)
    nums = re.findall(r'(?<![\w-])\d+\.\d+(?![\w-])', rest)
    desc = re.split(r'\s{2,}', rest)[0]
    rows.append((code, cityrural, desc, nums))
print(len(rows), 'rows')
bad = 0
for code, cr, desc, nums in rows:
    if len(nums) < 2: print('NONUM', code, desc); bad += 1; continue
    tot = float(nums[-1]); s = sum(float(x) for x in nums[:-1])
    if abs(s - tot) > 0.011: bad += 1; print('MISMATCH', code, desc, nums, round(s,3), tot)
print('bad', bad)
codes = [r[0] for r in rows]; print('dupes', len(codes)-len(set(codes)))
for r in rows[:3]+rows[-3:]: print(r)
