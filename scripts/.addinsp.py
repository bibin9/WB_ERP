# -*- coding: utf-8 -*-
"""Add the INV-11 checks to the screens suite."""
import io

p = "scripts/test-stores-screens.mjs"
s = io.open(p, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s[:4000] else "\n"

old_ids = 'for (const id of ["stores-items", "stores-stock", "stores-movements", "stores-material-on-jobs"]) {'
new_ids = (
    "for (const id of [" + nl
    + '  "stores-items", "stores-stock", "stores-movements", "stores-material-on-jobs", "stores-inspection",' + nl
    + "]) {"
)
assert s.count(old_ids) == 1
s = s.replace(old_ids, new_ids, 1)

marker = "  // INV-10: goods receipt against the order."
block = [
    "  // INV-11: QA/QC inspects; accepted stored, rejected flagged for return.",
    '  const movements = read("src/app/(app)/inventory/movements/page.tsx");',
    '  ok("INV-11 a delivery shows its inspection state", /INSPECTION_HELP/.test(movements));',
    '  ok("  and can be passed or failed from the screen", /<InspectDelivery/.test(movements));',
    '  ok("  the stock screen separates what is free to issue",',
    '    /Free to issue/.test(read("src/app/(app)/inventory/stock/page.tsx")),',
    '    "on the shelf and usable are two different questions");',
    '  ok("  and the issue check reads usable rather than present",',
    '    /balance\\.usable/.test(read("src/lib/stock.ts")));',
    "",
    marker,
]
assert s.count(marker) == 1
s = s.replace(marker, nl.join(block), 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("INV-11 checks added")
