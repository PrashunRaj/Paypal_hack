# Sample bills for testing

Fictional bills (made-up shops) for trying EarmarkPay's AI checks. They are generated from the HTML files in `src/`.
Use them with the demo earmark: purpose "Diabetes medicine and groceries", rules
"Only medicine and groceries. No alcohol or cigarettes. Ask me before paying any bill over $100."

| File | What it shows | Expected result (with a Gemini key) |
|---|---|---|
| `1-pharmacy.png` | Medicine + a beer, total $50 | Auto-approved, **$42 paid**, beer left out |
| `2-pharmacy-edited.png` | Items add up to $40, total says $90 (in a different font) | **High risk**, waits for the sender |
| `3-grocery.png` | Groceries, $120 | Waits for the sender (over the $100 review limit) |
| `4-fake-gst.png` | GST number with a wrong check digit | Flagged: **invalid GST number** |
| `1-pharmacy.png` again | Same file uploaded twice | **Rejected** as a duplicate |

The dates are printed when the images are generated. Bills older than 60 days get flagged, so re-render them if needed:
open each file in `src/` in a browser and take a screenshot.
