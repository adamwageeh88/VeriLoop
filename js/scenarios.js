/*
 * VeriLoop prototype — scripted scenario data.
 *
 * EVERYTHING IN THIS FILE IS SIMULATED. No language model, sandbox or test
 * runner is called. Each scenario scripts what the assistant proposes and
 * what a (planned) sandboxed verification pipeline would report, so the
 * interaction design can be demonstrated and evaluated without a backend.
 *
 * Structure
 *   scenario.versions[id]   one proposed change from the assistant
 *     .assistant            what the model says (its *claim*)
 *     .diff                 the proposed patch
 *     .verification         what the sandbox reports (the *evidence*)
 *     .moreTests            optional: result of "Request more tests"
 *     .autoRevise           optional: id of the version the closed loop
 *                           produces automatically when tests fail
 *     .reviseTo             id of the version produced by "Ask to revise"
 *   scenario.truth          ground truth used only in the researcher view,
 *                           to score whether a decision was appropriate
 */

const REPO = {
  name: "shopkit",
  language: "Python 3.12",
  testCommand: "pytest -q",
  files: [
    { path: "shopkit/pricing.py" },
    { path: "shopkit/cart.py" },
    { path: "shopkit/invoice.py" },
    { path: "shopkit/pagination.py" },
    { path: "shopkit/shipping.py" },
    { path: "shopkit/search.py" },
    { path: "shopkit/models.py" },
    { path: "shopkit/payments.py" },
    { path: "api/routes.py" },
    { path: "requirements.txt" },
    { path: "tests/test_pricing.py" },
    { path: "tests/test_cart.py" },
    { path: "tests/test_invoice.py" },
    { path: "tests/test_pagination.py" },
    { path: "tests/test_shipping.py" },
    { path: "tests/test_cache.py" }
  ]
};

const SCENARIOS = [
  /* ------------------------------------------------------------------ */
  /* Practice task: shown first in participant sessions, excluded from analysis */
  {
    id: "practice",
    title: "Practice: rename a variable",
    practice: true,
    tag: "Practice",
    blurb: "Rename a short variable name so the code is easier to read.",
    prompt: "In cart.py, rename the variable amt to amount in line_total(). Don't change behaviour.",
    truth: { v1: { accept: "appropriate", reject: "over-cautious", note: "Practice task; not analysed." } },
    start: "v1",
    versions: {
      v1: {
        label: "Proposal 1",
        assistant: {
          summary: "Renamed amt to amount in line_total(). Nothing else changed.",
          claims: [
            { id: "c1", text: "Behaviour is unchanged." },
            { id: "c2", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/cart.py", hunks: [
            { header: "@@ -6,3 +6,3 @@ def line_total(item):", lines: [
              [" ", 6, 6, "def line_total(item):"],
              ["-", 7, null, "    amt = item.price * item.qty"],
              ["-", 8, null, "    return round_money(amt)"],
              ["+", null, 7, "    amount = item.price * item.qty", "rename"],
              ["+", null, 8, "    return round_money(amount)", "rename"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [24, 24], generated: [0, 0], differential: [40, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.37s" } },
            { id: "e2", title: "Output identical to original on 40 inputs", detail: "line_total() gives the same result before and after the change.", highlight: "rename", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_line_total.py", log: "40 agree, 0 disagree" } }
          ],
          failed: [],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Differential test e2." },
            { claim: "c2", status: "supported", note: "24/24 in the test area." }
          ],
          assessment: { level: "low", text: "Low risk. The evidence covers the whole change." }
        }
      }
    }
  },

  /* ------------------------------------------------------------------ */
  {
    id: "discount",
    title: "Add discount codes",
    tag: "Hidden regression",
    blurb: "Add percentage discount codes to the checkout total.",
    prompt:
      "Add support for percentage discount codes (SAVE10, SAVE25) to checkout_total in cart.py.",
    truth: {
      v1: { accept: "inappropriate", reject: "appropriate", note: "v1 changes shared round_money(); invoice totals silently change on half-penny values." },
      v1b: { accept: "inappropriate", reject: "appropriate", note: "Failed checks are visible; accepting integrates a known regression." },
      v2: { accept: "appropriate", reject: "over-cautious", note: "v2 leaves round_money() untouched; differential tests agree with baseline." },
      v3: { accept: "appropriate", reject: "over-cautious", note: "v3 follows the rounding rule the user set." }
    },
    start: "v1",
    versions: {
      v1: {
        label: "Proposal 1",
        assistant: {
          summary:
            "I added a DISCOUNT_CODES table and an apply_discount() helper in pricing.py, and wired it into checkout_total(). I also switched round_money() to round down so customers are never overcharged after a discount.",
          claims: [
            { id: "c1", text: "Discount codes SAVE10 and SAVE25 now work at checkout." },
            { id: "c2", text: "All tests pass." },
            { id: "c3", text: "No other behaviour has changed." }
          ]
        },
        diff: [
          { file: "shopkit/pricing.py", hunks: [
            { header: "@@ -1,8 +1,18 @@", lines: [
              [" ", 1, 1, "from decimal import Decimal, ROUND_HALF_UP"],
              ["+", null, 2, "from decimal import ROUND_DOWN"],
              [" ", 2, 3, ""],
              [" ", 3, 4, "def round_money(value):"],
              ["-", 4, null, "    return Decimal(value).quantize(Decimal(\"0.01\"), rounding=ROUND_HALF_UP)", "shared"],
              ["+", null, 5, "    # Round down so customers are never overcharged after a discount", "shared"],
              ["+", null, 6, "    return Decimal(value).quantize(Decimal(\"0.01\"), rounding=ROUND_DOWN)", "shared"],
              [" ", 5, 7, ""],
              ["+", null, 8, "DISCOUNT_CODES = {\"SAVE10\": Decimal(\"0.10\"), \"SAVE25\": Decimal(\"0.25\")}"],
              ["+", null, 9, ""],
              ["+", null, 10, "def apply_discount(subtotal, code):", "feature"],
              ["+", null, 11, "    rate = DISCOUNT_CODES.get(code.upper())", "feature"],
              ["+", null, 12, "    if rate is None:", "unknown"],
              ["+", null, 13, "        raise ValueError(f\"Unknown discount code: {code}\")", "unknown"],
              ["+", null, 14, "    return round_money(Decimal(subtotal) * (1 - rate))", "feature"]
            ]}
          ]},
          { file: "shopkit/cart.py", hunks: [
            { header: "@@ -12,5 +12,7 @@ def checkout_total(cart, code=None):", lines: [
              [" ", 12, 12, "def checkout_total(cart, code=None):"],
              [" ", 13, 13, "    subtotal = sum(item.price * item.qty for item in cart.items)"],
              ["+", null, 14, "    if code:", "feature"],
              ["+", null, 15, "        subtotal = apply_discount(subtotal, code)", "feature"],
              [" ", 14, 16, "    return round_money(subtotal)"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [24, 24], generated: [3, 3], differential: null },
          changedLineCoverage: 82,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.41s" } },
            { id: "e2", title: "SAVE10 and SAVE25 reduce the total", detail: "Generated tests check 10% and 25% off a £40.00 cart.", highlight: "feature", source: { kind: "generated test", ref: "tests/_gen/test_discount.py::test_save10, ::test_save25", log: "test_save10 PASSED  (40.00 -> 36.00)\ntest_save25 PASSED  (40.00 -> 30.00)" } },
            { id: "e3", title: "Unknown code raises ValueError", detail: "Generated test passes \"BOGUS\" and expects an error.", highlight: "unknown", source: { kind: "generated test", ref: "tests/_gen/test_discount.py::test_unknown_code", log: "test_unknown_code PASSED" } }
          ],
          failed: [],
          unresolved: [
            { id: "r1", severity: "high", resolve: [{ kind: "more", label: "Test the code that uses it" }, { kind: "revise", label: "Ask the assistant not to change it", hint: "Don't change round_money(); it's shared with invoice.py. Keep discount rounding local to apply_discount()." }], title: "Shared function round_money() changed behaviour", detail: "Rounding mode changed from HALF_UP to DOWN. round_money() is also called by invoice.total_with_tax() (3 call sites). Existing tests only use whole-penny values, so they run these lines without detecting the change.", why: "Line coverage ≠ behaviour checked.", highlight: "shared", source: { kind: "static call graph", ref: "callers(round_money)", log: "shopkit/cart.py:16      checkout_total\nshopkit/invoice.py:22   total_with_tax\nshopkit/invoice.py:31   total_with_tax\nshopkit/invoice.py:40   refund_amount" } },
            { id: "r2", severity: "medium", resolve: [{ kind: "more", label: "Compare with the original code" }, { kind: "answer", label: "Review the tests yourself", question: "Do these tests check what you asked for?", show: "def test_save10():\n    assert checkout_total(cart_40, \"SAVE10\") == Decimal(\"36.00\")\n\ndef test_save25():\n    assert checkout_total(cart_40, \"SAVE25\") == Decimal(\"30.00\")\n\ndef test_unknown_code():\n    with pytest.raises(ValueError):\n        checkout_total(cart_40, \"BOGUS\")", options: [
                { label: "Yes, they test what I asked for", result: "checked", evidence: { title: "You reviewed the feature tests", detail: "You confirmed the 3 generated tests match the request, so they now count as your own check.", source: { kind: "your review", ref: "tests/_gen/test_discount.py", log: "reviewed by you: matches request" } } },
                { label: "No, something is missing", result: "failed", evidence: { title: "Feature tests do not cover the request", detail: "You judged that the generated tests miss part of what you asked for. Ask the assistant to revise the change and its tests.", source: { kind: "your review", ref: "tests/_gen/test_discount.py", log: "reviewed by you: incomplete" } } }
              ] }], title: "Tests were written by the same assistant as the code", detail: "The 3 generated tests encode the assistant's own reading of the request; they cannot reveal a misunderstanding they share with the code.", why: "Not independent evidence.", source: { kind: "pipeline note", ref: "generator = code assistant", log: "test author: assistant (same session)" } }
          ],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Backed by generated tests e2 and e3." },
            { claim: "c2", status: "supported", note: "24/24 existing and 3/3 generated tests passed in the sandbox." },
            { claim: "c3", status: "contradicted", note: "round_money() rounding mode changed and it has 3 callers outside the feature (r1)." }
          ],
          assessment: { level: "caution", text: "Tests pass, but a shared function changed in a way the tests do not check." }
        },
        moreTests: "v1b",
        reviseTo: "v2"
      },

      v1b: {
        label: "Proposal 1 + extra tests",
        sameAs: "v1",
        verification: {
          stages: "targeted",
          runs: { existing: [24, 24], generated: [3, 3], differential: [38, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.41s" } },
            { id: "e2", title: "SAVE10 and SAVE25 reduce the total", detail: "Generated tests check 10% and 25% off a £40.00 cart.", highlight: "feature", source: { kind: "generated test", ref: "tests/_gen/test_discount.py", log: "test_save10 PASSED\ntest_save25 PASSED" } },
            { id: "e3", title: "Unknown code raises ValueError", detail: "Generated test passes \"BOGUS\" and expects an error.", highlight: "unknown", source: { kind: "generated test", ref: "tests/_gen/test_discount.py::test_unknown_code", log: "test_unknown_code PASSED" } }
          ],
          failed: [
            { id: "f1", title: "Invoice tax total differs from original code", detail: "Differential test: total_with_tax(£9.65, 5%) returned £10.13 before the patch and £10.12 after it.", highlight: "shared", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_invoice.py::test_half_penny_tax", log: "FAILED test_half_penny_tax\n  baseline: Decimal('10.13')\n  patched:  Decimal('10.12')\n  input:    subtotal=9.65 rate=0.05" } },
            { id: "f2", title: "round_money(2.345) changed from 2.35 to 2.34", detail: "2 of 40 sampled half-penny inputs disagree with the original behaviour.", highlight: "shared", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_pricing.py (40 sampled inputs)", log: "38 agree, 2 disagree\n  2.345 -> 2.35 (baseline) / 2.34 (patch)\n  0.125 -> 0.13 (baseline) / 0.12 (patch)" } }
          ],
          unresolved: [
            { id: "r2", severity: "medium", resolve: [{ kind: "answer", label: "Review the tests yourself", question: "Do these tests check what you asked for?", show: "def test_save10():\n    assert checkout_total(cart_40, \"SAVE10\") == Decimal(\"36.00\")\n\ndef test_save25():\n    assert checkout_total(cart_40, \"SAVE25\") == Decimal(\"30.00\")\n\ndef test_unknown_code():\n    with pytest.raises(ValueError):\n        checkout_total(cart_40, \"BOGUS\")", options: [
                { label: "Yes, they test what I asked for", result: "checked", evidence: { title: "You reviewed the feature tests", detail: "You confirmed the 3 generated tests match the request, so they now count as your own check.", source: { kind: "your review", ref: "tests/_gen/test_discount.py", log: "reviewed by you: matches request" } } },
                { label: "No, something is missing", result: "failed", evidence: { title: "Feature tests do not cover the request", detail: "You judged that the generated tests miss part of what you asked for. Ask the assistant to revise the change and its tests.", source: { kind: "your review", ref: "tests/_gen/test_discount.py", log: "reviewed by you: incomplete" } } }
              ] }], title: "Feature tests were written by the same assistant", detail: "Differential tests compare against the original code, so they are independent of the assistant; the 3 feature tests are not.", why: "Partly independent evidence.", source: { kind: "pipeline note", ref: "generator = code assistant", log: "feature tests: assistant\ndifferential tests: baseline comparison" } }
          ],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Backed by generated tests e2 and e3." },
            { claim: "c2", status: "partial", note: "True for the original suite; 2 new differential checks fail." },
            { claim: "c3", status: "contradicted", note: "Invoice totals change for half-penny values (f1, f2)." }
          ],
          assessment: { level: "blocked", text: "The patch changes existing invoice behaviour. Integrating it would introduce a regression." }
        },
        reviseTo: "v2",
        reviseHint: "Invoice totals now differ from the original code on half-penny values (see the failed checks)."
      },

      v2: {
        label: "Proposal 2 (revised)",
        assistant: {
          summary:
            "Revised: round_money() is unchanged. apply_discount() now does its own rounding with ROUND_HALF_UP, so invoice.py is unaffected.",
          claims: [
            { id: "c1", text: "Discount codes SAVE10 and SAVE25 now work at checkout." },
            { id: "c2", text: "All tests pass." },
            { id: "c3", text: "round_money() and invoice totals are unchanged." }
          ]
        },
        diff: [
          { file: "shopkit/pricing.py", hunks: [
            { header: "@@ -5,3 +5,11 @@", lines: [
              [" ", 5, 5, ""],
              ["+", null, 6, "DISCOUNT_CODES = {\"SAVE10\": Decimal(\"0.10\"), \"SAVE25\": Decimal(\"0.25\")}"],
              ["+", null, 7, ""],
              ["+", null, 8, "def apply_discount(subtotal, code):", "feature"],
              ["+", null, 9, "    rate = DISCOUNT_CODES.get(code.upper())", "feature"],
              ["+", null, 10, "    if rate is None:", "unknown"],
              ["+", null, 11, "        raise ValueError(f\"Unknown discount code: {code}\")", "unknown"],
              ["+", null, 12, "    discounted = Decimal(subtotal) * (1 - rate)", "feature"],
              ["+", null, 13, "    return discounted.quantize(Decimal(\"0.01\"), rounding=ROUND_HALF_UP)", "rounding"]
            ]}
          ]},
          { file: "shopkit/cart.py", hunks: [
            { header: "@@ -12,5 +12,7 @@ def checkout_total(cart, code=None):", lines: [
              [" ", 12, 12, "def checkout_total(cart, code=None):"],
              [" ", 13, 13, "    subtotal = sum(item.price * item.qty for item in cart.items)"],
              ["+", null, 14, "    if code:", "feature"],
              ["+", null, 15, "        subtotal = apply_discount(subtotal, code)", "feature"],
              [" ", 14, 16, "    return round_money(subtotal)"]
            ]}
          ]}
        ],
        verification: {
          stages: "targeted",
          runs: { existing: [24, 24], generated: [5, 5], differential: [40, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.40s" } },
            { id: "e4", title: "Invoice and rounding behaviour match the original", detail: "40/40 sampled inputs, including half-penny values, give identical results before and after the patch.", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_*.py", log: "40 agree, 0 disagree" } },
            { id: "e2", title: "SAVE10 and SAVE25 reduce the total", detail: "Generated tests check 10% and 25% off, including a half-penny result.", highlight: "feature", source: { kind: "generated test", ref: "tests/_gen/test_discount.py", log: "test_save10 PASSED\ntest_save25 PASSED\ntest_save10_half_penny PASSED (9.65 -> 8.69)" } },
            { id: "e3", title: "Unknown code raises ValueError", detail: "Generated test passes \"BOGUS\" and expects an error.", highlight: "unknown", source: { kind: "generated test", ref: "tests/_gen/test_discount.py::test_unknown_code", log: "test_unknown_code PASSED" } }
          ],
          failed: [],
          unresolved: [
            { id: "r3", severity: "low", resolve: [{ kind: "answer", label: "Answer: how should discounts round?", question: "How should a discounted price be rounded to the penny?", options: [
                { label: "Half-up (£8.685 becomes £8.69), like the rest of the shop", rule: { key: "discount-rounding", text: "Discounted prices round half-up" }, result: "checked", evidence: { title: "Rounding matches your rule (half-up)", detail: "You set the rule. apply_discount() rounds half-up, and the half-penny test confirms it.", highlight: "rounding", source: { kind: "your requirement + generated test", ref: "test_save10_half_penny", log: "rule: half-up (set by you)\n9.65 -> 8.69 PASSED" } } },
                { label: "Always down, so customers are never overcharged", rule: { key: "discount-rounding", text: "Discounted prices always round down" }, result: "failed", reviseTo: "v3", hint: "Discounted prices must always round down. Change only apply_discount(); keep round_money() as it is.", evidence: { title: "Rounding does not match your rule (always down)", detail: "You set the rule to round down, but apply_discount() rounds half-up. Ask for a revision to fix it.", highlight: "rounding", source: { kind: "your requirement vs code", ref: "shopkit/pricing.py:13", log: "rule: round down (set by you)\ncode: ROUND_HALF_UP" } } },
                { label: "I don't know yet; I'll check with the product owner", result: "accepted", note: "Open question for the product owner." }
              ] }], title: "Discount rounding rule is the assistant's assumption", detail: "No written requirement says whether discounted prices round half-up or down. Tests confirm the code does what the assistant intended, not what the business wants.", why: "Tests check the code against itself, not against requirements.", highlight: "rounding", source: { kind: "requirements check", ref: "docs/ and issue text searched", log: "no rounding rule found for discounts" } }
          ],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Backed by generated tests e2 and e3." },
            { claim: "c2", status: "supported", note: "24/24 existing, 5/5 generated, 40/40 differential." },
            { claim: "c3", status: "supported", note: "Differential tests agree with baseline on all sampled inputs (e4)." }
          ],
          assessment: { level: "review", text: "Evidence covers the change. One business-rule question is yours to answer." }
        }
      },
      v3: {
        label: "Proposal 3 (rounds down)",
        assistant: {
          summary: "Revised to follow your rule: apply_discount() now always rounds down. round_money() is still unchanged.",
          claims: [
            { id: "c1", text: "Discounted prices always round down." },
            { id: "c2", text: "round_money() and invoice totals are unchanged." },
            { id: "c3", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/pricing.py", hunks: [
            { header: "@@ -1,8 +1,17 @@", lines: [
              [" ", 1, 1, "from decimal import Decimal, ROUND_HALF_UP"],
              ["+", null, 2, "from decimal import ROUND_DOWN"],
              [" ", 5, 6, ""],
              ["+", null, 7, "DISCOUNT_CODES = {\"SAVE10\": Decimal(\"0.10\"), \"SAVE25\": Decimal(\"0.25\")}"],
              ["+", null, 8, ""],
              ["+", null, 9, "def apply_discount(subtotal, code):", "feature"],
              ["+", null, 10, "    rate = DISCOUNT_CODES.get(code.upper())", "feature"],
              ["+", null, 11, "    if rate is None:", "unknown"],
              ["+", null, 12, "        raise ValueError(f\"Unknown discount code: {code}\")", "unknown"],
              ["+", null, 13, "    discounted = Decimal(subtotal) * (1 - rate)", "feature"],
              ["+", null, 14, "    # Business rule: discounted prices always round down", "rounding"],
              ["+", null, 15, "    return discounted.quantize(Decimal(\"0.01\"), rounding=ROUND_DOWN)", "rounding"]
            ]}
          ]},
          { file: "shopkit/cart.py", hunks: [
            { header: "@@ -12,5 +12,7 @@ def checkout_total(cart, code=None):", lines: [
              [" ", 12, 12, "def checkout_total(cart, code=None):"],
              [" ", 13, 13, "    subtotal = sum(item.price * item.qty for item in cart.items)"],
              ["+", null, 14, "    if code:", "feature"],
              ["+", null, 15, "        subtotal = apply_discount(subtotal, code)", "feature"],
              [" ", 14, 16, "    return round_money(subtotal)"]
            ]}
          ]}
        ],
        verification: {
          stages: "targeted",
          runs: { existing: [24, 24], generated: [5, 5], differential: [40, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.40s" } },
            { id: "e4", title: "Invoice and rounding behaviour match the original", detail: "40/40 sampled inputs give identical results for round_money() and invoice totals.", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_*.py", log: "40 agree, 0 disagree" } },
            { id: "e5", title: "Discounts round down, as you specified", detail: "Half-penny discount results round down (9.65 with SAVE10 gives 8.68).", highlight: "rounding", source: { kind: "generated test from your rule", ref: "tests/_gen/test_discount.py::test_rounds_down", log: "test_rounds_down PASSED (9.65 -> 8.68)" } },
            { id: "e2", title: "SAVE10 and SAVE25 reduce the total", detail: "Generated tests check 10% and 25% off a £40.00 cart.", highlight: "feature", source: { kind: "generated test", ref: "tests/_gen/test_discount.py", log: "test_save10 PASSED\ntest_save25 PASSED" } },
            { id: "e3", title: "Unknown code raises ValueError", detail: "Generated test passes \"BOGUS\" and expects an error.", highlight: "unknown", source: { kind: "generated test", ref: "tests/_gen/test_discount.py::test_unknown_code", log: "test_unknown_code PASSED" } }
          ],
          failed: [],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Generated test from your rule (e5)." },
            { claim: "c2", status: "supported", note: "Differential tests agree with the original (e4)." },
            { claim: "c3", status: "supported", note: "24/24 existing, 5/5 generated, 40/40 differential." }
          ],
          assessment: { level: "low", text: "The change follows your rounding rule and leaves existing behaviour unchanged." }
        }
      }
    }
  },

  /* ------------------------------------------------------------------ */
  {
    id: "pagination",
    title: "Fix pagination bug",
    tag: "Closed loop + flaky test",
    blurb: "Page 1 of the product list shows the wrong items.",
    prompt:
      "Pages are 1-indexed in the API but page=1 returns the second page of results. Fix paginate() in pagination.py.",
    truth: {
      v1: { accept: "inappropriate", reject: "appropriate", note: "v1 still returns 11 items per page." },
      v2: { accept: "appropriate", reject: "over-cautious", note: "v2 is correct; the flaky cache test is pre-existing and unrelated." },
      v3: { accept: "appropriate", reject: "over-cautious", note: "v3 also follows the user's page=0 rule." }
    },
    start: "v1",
    versions: {
      v1: {
        label: "Attempt 1",
        assistant: {
          summary: "Fixed the off-by-one: start is now computed from (page - 1).",
          claims: [
            { id: "c1", text: "page=1 now returns the first page." },
            { id: "c2", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/pagination.py", hunks: [
            { header: "@@ -3,5 +3,5 @@ def paginate(items, page, per_page=10):", lines: [
              [" ", 3, 3, "def paginate(items, page, per_page=10):"],
              ["-", 4, null, "    start = page * per_page"],
              ["+", null, 4, "    start = (page - 1) * per_page", "start"],
              [" ", 5, 5, "    end = start + per_page + 1", "end"],
              [" ", 6, 6, "    return items[start:end]"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [17, 18], generated: [2, 2], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "page=1 starts at the first item", detail: "Generated test checks paginate(range(25), 1)[0] == 0.", highlight: "start", source: { kind: "generated test", ref: "tests/_gen/test_page_one.py", log: "test_first_item PASSED" } }
          ],
          failed: [
            { id: "f1", title: "test_page_size_respected fails: 11 items returned, expected 10", detail: "An existing test fails. The end index still adds +1, a second off-by-one the assistant did not fix.", highlight: "end", source: { kind: "test run", ref: "tests/test_pagination.py::test_page_size_respected", log: "FAILED test_page_size_respected\n  assert len(paginate(range(25), 1)) == 10\n  AssertionError: 11 != 10" } }
          ],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Generated test e1 passes." },
            { claim: "c2", status: "contradicted", note: "1 existing test fails in the sandbox (f1)." }
          ],
          assessment: { level: "blocked", text: "An existing test fails." }
        },
        autoRevise: "v2",
        reviseTo: "v2",
        reviseHint: "test_page_size_respected fails: 11 items are returned instead of 10."
      },
      v2: {
        label: "Attempt 2",
        assistant: {
          summary: "Also removed the extra +1 on the end index, which test_page_size_respected caught. Both start and end are now correct for 1-indexed pages.",
          claims: [
            { id: "c1", text: "page=1 now returns the first page." },
            { id: "c2", text: "Each page has exactly per_page items." },
            { id: "c3", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/pagination.py", hunks: [
            { header: "@@ -3,5 +3,5 @@ def paginate(items, page, per_page=10):", lines: [
              [" ", 3, 3, "def paginate(items, page, per_page=10):"],
              ["-", 4, null, "    start = page * per_page"],
              ["-", 5, null, "    end = start + per_page + 1"],
              ["+", null, 4, "    start = (page - 1) * per_page", "start"],
              ["+", null, 5, "    end = start + per_page", "end"],
              [" ", 6, 6, "    return items[start:end]", "zero"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [17, 18, 1], generated: [3, 3], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "page=1 starts at the first item", detail: "Generated test checks paginate(range(25), 1)[0] == 0.", highlight: "start", source: { kind: "generated test", ref: "tests/_gen/test_page_one.py", log: "test_first_item PASSED" } },
            { id: "e2", title: "Pages have exactly per_page items", detail: "Existing test test_page_size_respected now passes; last partial page has 5 items.", highlight: "end", source: { kind: "test run", ref: "tests/test_pagination.py", log: "test_page_size_respected PASSED\ntest_last_page_partial PASSED" } },
            { id: "e3", title: "16 other existing tests pass", detail: "All tests unrelated to the flaky cache test pass.", source: { kind: "test run", ref: "pytest -q tests/", log: "16 passed" } }
          ],
          failed: [],
          inconclusive: [
            { id: "i1", resolve: [{ kind: "test", label: "Re-run it 10 more times", running: "Re-running test_cache_expiry_timing 10 times on both versions…", result: "checked", evidence: { title: "Unreliable cache test is unrelated to this change", detail: "It failed 3 of 10 runs on the original code and 3 of 10 with the change, so its failures do not depend on this change.", source: { kind: "repeated runs on original and changed code", ref: "tests/test_cache.py::test_cache_expiry_timing", log: "original: 7 pass, 3 fail\nchanged:  7 pass, 3 fail" } } }], title: "test_cache_expiry_timing is flaky — not caused by this change", detail: "Passed 2 of 3 runs with the patch, and also failed 1 of 3 runs on the unchanged code. The pipeline does not count it for or against the change.", source: { kind: "re-run on patch and baseline", ref: "tests/test_cache.py::test_cache_expiry_timing", log: "patched:  PASS FAIL PASS\nbaseline: PASS PASS FAIL\n=> flaky on baseline; excluded from verdict" } }
          ],
          unresolved: [
            { id: "r1", severity: "low", resolve: [{ kind: "answer", label: "Answer: what should page=0 do?", question: "What should happen when someone asks for page=0?", options: [
                { label: "Nothing sends 0; an empty list is fine", rule: { key: "page-zero", text: "page=0 is not a supported input" }, result: "checked", evidence: { title: "You confirmed page=0 is not a supported input", detail: "api/routes.py always sends page 1 or more, and you accepted that page=0 returns nothing.", highlight: "zero", source: { kind: "your decision + call graph", ref: "api/routes.py:18", log: "page defaults to 1; page=0 unsupported (set by you)" } } },
                { label: "Treat it as page 1, like before", rule: { key: "page-zero", text: "page=0 should return the first page" }, result: "failed", reviseTo: "v3", hint: "Treat page values below 1 as page 1, so page=0 still returns the first page.", evidence: { title: "page=0 no longer behaves as you want", detail: "You want page=0 to return the first page, but it now returns an empty list. Ask for a revision to fix it.", highlight: "zero", source: { kind: "your requirement vs code", ref: "paginate(items, 0)", log: "rule: page=0 -> first page (set by you)\nresult: []" } } }
              ] }], title: "page=0 now returns an empty list", detail: "Previously page=0 returned the first page. No test or requirement covers page=0. api/routes.py defaults page to 1, so normal requests are unaffected.", why: "Edge case outside the stated request.", highlight: "zero", source: { kind: "static call graph", ref: "callers(paginate)", log: "api/routes.py:18  list_products  page=int(q.get('page', 1))" } }
          ],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Generated test e1." },
            { claim: "c2", status: "supported", note: "Existing test e2." },
            { claim: "c3", status: "partial", note: "One test is flaky on the unchanged code too (i1); all others pass." }
          ],
          assessment: { level: "review", text: "The fix is verified. One edge case and one pre-existing flaky test are for you to judge." }
        }
      },
      v3: {
        label: "Attempt 3 (page=0 fixed)",
        assistant: {
          summary: "Revised to follow your rule: page values below 1 are treated as page 1.",
          claims: [
            { id: "c1", text: "page=1 and page=0 both return the first page." },
            { id: "c2", text: "Each page has exactly per_page items." },
            { id: "c3", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/pagination.py", hunks: [
            { header: "@@ -3,5 +3,6 @@ def paginate(items, page, per_page=10):", lines: [
              [" ", 3, 3, "def paginate(items, page, per_page=10):"],
              ["-", 4, null, "    start = page * per_page"],
              ["-", 5, null, "    end = start + per_page + 1"],
              ["+", null, 4, "    page = max(page, 1)  # treat 0 or less as the first page", "zero"],
              ["+", null, 5, "    start = (page - 1) * per_page", "start"],
              ["+", null, 6, "    end = start + per_page", "end"],
              [" ", 6, 7, "    return items[start:end]"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [17, 18, 1], generated: [4, 4], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "page=1 starts at the first item", detail: "Generated test checks paginate(range(25), 1)[0] == 0.", highlight: "start", source: { kind: "generated test", ref: "tests/_gen/test_page_one.py", log: "test_first_item PASSED" } },
            { id: "e4", title: "page=0 returns the first page, as you specified", detail: "Generated test from your rule: paginate(range(25), 0) returns items 0 to 9.", highlight: "zero", source: { kind: "generated test from your rule", ref: "tests/_gen/test_page_zero.py", log: "test_page_zero_is_first_page PASSED" } },
            { id: "e2", title: "Pages have exactly per_page items", detail: "Existing test test_page_size_respected passes; last partial page has 5 items.", highlight: "end", source: { kind: "test run", ref: "tests/test_pagination.py", log: "test_page_size_respected PASSED\ntest_last_page_partial PASSED" } },
            { id: "e3", title: "16 other existing tests pass", detail: "All tests apart from the unreliable cache test pass.", source: { kind: "test run", ref: "pytest -q tests/", log: "16 passed" } }
          ],
          failed: [],
          inconclusive: [
            { id: "i1", resolve: [{ kind: "test", label: "Re-run it 10 more times", running: "Re-running test_cache_expiry_timing 10 times on both versions…", result: "checked", evidence: { title: "Unreliable cache test is unrelated to this change", detail: "It failed 3 of 10 runs on the original code and 3 of 10 with the change, so its failures do not depend on this change.", source: { kind: "repeated runs on original and changed code", ref: "tests/test_cache.py::test_cache_expiry_timing", log: "original: 7 pass, 3 fail\nchanged:  7 pass, 3 fail" } } }], title: "test_cache_expiry_timing is flaky — not caused by this change", detail: "Passed 2 of 3 runs with the patch, and also failed 1 of 3 runs on the unchanged code.", source: { kind: "re-run on patch and baseline", ref: "tests/test_cache.py::test_cache_expiry_timing", log: "patched:  PASS FAIL PASS\nbaseline: PASS PASS FAIL" } }
          ],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Generated tests e1 and e4." },
            { claim: "c2", status: "supported", note: "Existing test e2." },
            { claim: "c3", status: "partial", note: "One unreliable test also fails on the original code (i1); all others pass." }
          ],
          assessment: { level: "review", text: "The fix follows your rule. One unreliable test, unrelated to this change, is left to judge." }
        }
      }
    }
  },


  /* ------------------------------------------------------------------ */
  /* Checks pass but miss a bug: tests the person's reliance on VeriLoop  */
  {
    id: "shipping",
    title: "Add free shipping",
    tag: "Misleading green",
    blurb: "Give free shipping on orders of £50 or more.",
    prompt: "Orders of £50 or more should get free shipping. Update shipping_cost() in shipping.py.",
    truth: {
      v1: { accept: "inappropriate", reject: "appropriate", note: "Orders of exactly £50.00 are still charged. The generated tests never tried the boundary, so every check passed." },
      v2: { accept: "appropriate", reject: "over-cautious", note: "v2 uses >= and is tested at exactly £50.00." }
    },
    start: "v1",
    versions: {
      v1: {
        label: "Proposal 1",
        assistant: {
          summary: "Added a FREE_SHIPPING_FROM threshold of £50.00. shipping_cost() now returns £0.00 for orders above it.",
          claims: [
            { id: "c1", text: "Orders of £50 or more now ship free." },
            { id: "c2", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/shipping.py", hunks: [
            { header: "@@ -1,5 +1,9 @@", lines: [
              [" ", 1, 1, "from decimal import Decimal"],
              [" ", 2, 2, ""],
              [" ", 3, 3, "FLAT_RATE = Decimal(\"3.95\")"],
              ["+", null, 4, "FREE_SHIPPING_FROM = Decimal(\"50.00\")"],
              [" ", 4, 5, ""],
              [" ", 5, 6, "def shipping_cost(subtotal):"],
              ["+", null, 7, "    if subtotal > FREE_SHIPPING_FROM:", "threshold"],
              ["+", null, 8, "        return Decimal(\"0.00\")", "threshold"],
              [" ", 6, 9, "    return FLAT_RATE"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [24, 24], generated: [2, 2], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.38s" } },
            { id: "e2", title: "Large orders ship free", detail: "Generated test: an order of £60.00 has £0.00 shipping.", highlight: "threshold", source: { kind: "generated test", ref: "tests/_gen/test_shipping.py::test_free_over_threshold", log: "shipping_cost(Decimal('60.00')) == Decimal('0.00')  PASSED" } },
            { id: "e3", title: "Small orders are still charged", detail: "Generated test: an order of £40.00 has £3.95 shipping.", highlight: "threshold", source: { kind: "generated test", ref: "tests/_gen/test_shipping.py::test_charged_under_threshold", log: "shipping_cost(Decimal('40.00')) == Decimal('3.95')  PASSED" } },
            { id: "e4", title: "One caller found and tested", detail: "checkout_total() calls shipping_cost(); its existing tests pass.", source: { kind: "static call graph", ref: "callers(shipping_cost)", log: "shopkit/cart.py:17  checkout_total" } }
          ],
          failed: [],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Generated tests e2 and e3 pass." },
            { claim: "c2", status: "supported", note: "24/24 existing and 2/2 generated tests passed." }
          ],
          assessment: { level: "low", text: "Low risk. Every check passed." }
        },
        reviseTo: "v2",
        reviseHint: "",
        // The scripted fix only follows feedback that points at the real problem, so typing anything does not fix it for free
        reviseMatch: ["50", ">=", "boundary", "exactly", "equal", "or more", "edge", "inclusive", "threshold"],
        reviseMiss: "I compared the change with your request again. Orders above £50 ship free and orders below £50 are charged, and the tests confirm both. I can't find what to change from your message. Which orders are handled wrongly?"
      },
      v2: {
        label: "Proposal 2 (revised)",
        assistant: {
          summary: "Changed the comparison to >= so an order of exactly £50.00 also ships free, and added a test at the boundary.",
          claims: [
            { id: "c1", text: "Orders of £50 or more now ship free, including exactly £50.00." },
            { id: "c2", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/shipping.py", hunks: [
            { header: "@@ -1,5 +1,9 @@", lines: [
              [" ", 1, 1, "from decimal import Decimal"],
              [" ", 2, 2, ""],
              [" ", 3, 3, "FLAT_RATE = Decimal(\"3.95\")"],
              ["+", null, 4, "FREE_SHIPPING_FROM = Decimal(\"50.00\")"],
              [" ", 4, 5, ""],
              [" ", 5, 6, "def shipping_cost(subtotal):"],
              ["+", null, 7, "    if subtotal >= FREE_SHIPPING_FROM:", "threshold"],
              ["+", null, 8, "        return Decimal(\"0.00\")", "threshold"],
              [" ", 6, 9, "    return FLAT_RATE"]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [24, 24], generated: [3, 3], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.38s" } },
            { id: "e5", title: "An order of exactly £50.00 ships free", detail: "Generated test at the boundary.", highlight: "threshold", source: { kind: "generated test", ref: "tests/_gen/test_shipping.py::test_free_at_threshold", log: "shipping_cost(Decimal('50.00')) == Decimal('0.00')  PASSED" } },
            { id: "e2", title: "Large orders ship free", detail: "Generated test: an order of £60.00 has £0.00 shipping.", highlight: "threshold", source: { kind: "generated test", ref: "tests/_gen/test_shipping.py::test_free_over_threshold", log: "PASSED" } },
            { id: "e3", title: "Small orders are still charged", detail: "Generated test: an order of £49.99 has £3.95 shipping.", highlight: "threshold", source: { kind: "generated test", ref: "tests/_gen/test_shipping.py::test_charged_under_threshold", log: "shipping_cost(Decimal('49.99')) == Decimal('3.95')  PASSED" } }
          ],
          failed: [],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Boundary test e5 and tests e2, e3." },
            { claim: "c2", status: "supported", note: "24/24 existing and 3/3 generated tests passed." }
          ],
          assessment: { level: "low", text: "Low risk. Every check passed, including the boundary." }
        }
      }
    }
  },

  /* ------------------------------------------------------------------ */
  /* The assistant declines to claim what it cannot check (L07 decline)  */
  {
    id: "search",
    title: "Speed up product search",
    tag: "Assistant declines",
    blurb: "Search is slow when the catalogue is large.",
    prompt: "Make search_products() in search.py faster. It's slow with large catalogues.",
    truth: {
      v1: { accept: "appropriate", reject: "appropriate", note: "Behaviour is unchanged; the speed-up was never measured, so either decision is defensible." }
    },
    start: "q",
    versions: {
      q: {
        label: "Question",
        decline: {
          message: "I can make search_products() do less work per search, but I can't show you that it's faster: VeriLoop's checks don't measure speed. They can only confirm that search still returns the same results. Do you want me to go ahead on that basis?",
          options: [
            { label: "Go ahead, and check the results stay the same", go: "v1" },
            { label: "Cancel this request", go: null }
          ]
        }
      },
      v1: {
        label: "Proposal 1",
        assistant: {
          summary: "Each product now stores its search words once, when it is created, instead of splitting its name on every search.",
          claims: [
            { id: "c1", text: "Search is faster." },
            { id: "c2", text: "Search returns the same results as before." }
          ]
        },
        diff: [
          { file: "shopkit/models.py", hunks: [
            { header: "@@ -8,4 +8,8 @@ class Product:", lines: [
              [" ", 8, 8, "    name: str"],
              [" ", 9, 9, "    price: Decimal"],
              ["+", null, 10, "    search_words: frozenset = field(init=False)", "words"],
              ["+", null, 11, ""],
              ["+", null, 12, "    def __post_init__(self):", "words"],
              ["+", null, 13, "        self.search_words = frozenset(self.name.lower().split())", "words"]
            ]}
          ]},
          { file: "shopkit/search.py", hunks: [
            { header: "@@ -1,4 +1,4 @@ def search_products(products, query):", lines: [
              [" ", 1, 1, "def search_products(products, query):"],
              [" ", 2, 2, "    q = query.lower()"],
              ["-", 3, null, "    return [p for p in products if q in p.name.lower().split()]"],
              ["+", null, 3, "    return [p for p in products if q in p.search_words]", "speed"]
            ]}
          ]}
        ],
        verification: {
          stages: "targeted",
          runs: { existing: [24, 24], generated: [2, 2], differential: [40, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.41s" } },
            { id: "e2", title: "Search returns the same results as before", detail: "40 sampled queries return identical products before and after the change.", highlight: "speed", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_search.py", log: "40 agree, 0 disagree" } },
            { id: "e3", title: "Mixed-case names are still found", detail: "Generated test searches \"mug\" for a product named \"Blue MUG\".", highlight: "words", source: { kind: "generated test", ref: "tests/_gen/test_search.py", log: "test_case_insensitive PASSED\ntest_multi_word_name PASSED" } }
          ],
          failed: [],
          unresolved: [
            { id: "r1", severity: "medium", title: "Speed was not measured", detail: "The checks confirm that results are unchanged, but nothing here measures how fast search runs. The speed-up is only the assistant's claim.", why: "Outside what these checks cover.", highlight: "speed", source: { kind: "capability note", ref: "VeriLoop checks", log: "no performance measurement available" } }
          ],
          claimCheck: [
            { claim: "c1", status: "unchecked", note: "Speed is outside what VeriLoop checks (r1)." },
            { claim: "c2", status: "supported", note: "Differential test e2." }
          ],
          assessment: { level: "caution", text: "Results are unchanged, but the reason for the change, speed, was not checked." }
        }
      }
    }
  },

  /* ------------------------------------------------------------------ */
  /* The checks themselves break (L08: what users see when it fails)     */
  {
    id: "upgrade",
    title: "Upgrade the payment library",
    tag: "Checks fail to run",
    blurb: "Move the payment library to its latest version.",
    prompt: "Upgrade the payflow payment library from 2.8 to 3.2.",
    truth: {
      v1: { accept: "inappropriate", reject: "appropriate", note: "Applied with no evidence at all: the checks never ran." },
      v1r: { accept: "appropriate", reject: "over-cautious", note: "Checks ran on retry and passed." }
    },
    start: "v1",
    versions: {
      v1: {
        label: "Proposal 1",
        assistant: {
          summary: "Bumped payflow to 3.2.0 and updated the import, which moved to payflow.client in version 3.",
          claims: [
            { id: "c1", text: "payflow is upgraded to 3.2.0." },
            { id: "c2", text: "Payments work as before." }
          ]
        },
        diff: [
          { file: "requirements.txt", hunks: [
            { header: "@@ -3,3 +3,3 @@", lines: [
              [" ", 3, 3, "flask==3.0.3"],
              ["-", 4, null, "payflow==2.8.1"],
              ["+", null, 4, "payflow==3.2.0", "pin"],
              [" ", 5, 5, "pytest==8.2.0"]
            ]}
          ]},
          { file: "shopkit/payments.py", hunks: [
            { header: "@@ -1,3 +1,3 @@", lines: [
              ["-", 1, null, "from payflow import Client"],
              ["+", null, 1, "from payflow.client import Client", "import"],
              [" ", 2, 2, ""],
              [" ", 3, 3, "client = Client(api_key=settings.PAYFLOW_KEY)"]
            ]}
          ]}
        ],
        verification: {
          stages: "install",
          error: {
            atStage: 2,
            title: "Checks could not run",
            detail: "The new library version could not be downloaded into the test area: the package registry did not respond.",
            log: "$ pip install payflow==3.2.0\nERROR: Could not fetch payflow==3.2.0\n  Read timed out after 30 s (registry.example.org)\n0 tests run"
          }
        },
        retryTo: "v1r"
      },
      v1r: {
        label: "Proposal 1 (checks re-run)",
        sameAs: "v1",
        verification: {
          stages: "install",
          runs: { existing: [24, 24], generated: [2, 2], differential: null },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "payflow 3.2.0 installed in the test area", detail: "Installed on the second attempt.", highlight: "pin", source: { kind: "install log", ref: "pip install payflow==3.2.0", log: "Successfully installed payflow-3.2.0" } },
            { id: "e2", title: "Existing test suite passes (24/24)", detail: "Including the 6 payment tests, which use payflow's test mode.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.52s" } },
            { id: "e3", title: "New import path works", detail: "Generated test creates a Client from payflow.client.", highlight: "import", source: { kind: "generated test", ref: "tests/_gen/test_payments_import.py", log: "test_client_import PASSED\ntest_charge_test_mode PASSED" } }
          ],
          failed: [],
          unresolved: [
            { id: "r1", severity: "low", resolve: [{ kind: "test", label: "Search the code for refund calls", running: "Searching the project for payflow refund calls…", result: "checked", evidence: { title: "Nothing in your code calls payflow refunds", detail: "The refund changes in version 3 do not affect this project.", source: { kind: "code search", ref: "grep -r \"refund(\" shopkit api", log: "0 matches" } } }], title: "Version 3 changed how refunds work", detail: "payflow's changelog lists a breaking change to refund(). The tests don't cover refunds.", why: "Not covered by any test.", source: { kind: "library changelog", ref: "payflow 3.0.0 release notes", log: "BREAKING: refund() now requires a reason argument" } }
          ],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Install log e1." },
            { claim: "c2", status: "partial", note: "Charges are tested (e2, e3); refunds are not (r1)." }
          ],
          assessment: { level: "review", text: "The upgrade passes its checks. One library change is not covered by tests." }
        }
      }
    }
  },
  /* ------------------------------------------------------------------ */
  {
    id: "docstring",
    title: "Document an invoice helper",
    tag: "Low risk",
    blurb: "Add type hints and a docstring to an invoice helper.",
    prompt:
      "Add type hints and a docstring to format_invoice_line() in invoice.py. Don't change behaviour.",
    truth: {
      v1: { accept: "appropriate", reject: "over-cautious", note: "Documentation-only change; behaviour identical." }
    },
    start: "v1",
    versions: {
      v1: {
        label: "Proposal 1",
        assistant: {
          summary: "Added type hints and a docstring to format_invoice_line(). No logic changed.",
          claims: [
            { id: "c1", text: "Behaviour is unchanged." },
            { id: "c2", text: "All tests pass." }
          ]
        },
        diff: [
          { file: "shopkit/invoice.py", hunks: [
            { header: "@@ -8,4 +8,11 @@", lines: [
              ["-", 8, null, "def format_invoice_line(item, qty):"],
              ["+", null, 8, "def format_invoice_line(item: Item, qty: int) -> str:", "sig"],
              ["+", null, 9, "    \"\"\"Return one invoice line, e.g. '2 x Mug  £9.00'.", "doc"],
              ["+", null, 10, "", "doc"],
              ["+", null, 11, "    Prices are rounded with round_money() (half-up).", "doc"],
              ["+", null, 12, "    \"\"\"", "doc"],
              [" ", 9, 13, "    total = round_money(item.price * qty)"],
              [" ", 10, 14, "    return f\"{qty} x {item.name:<10} £{total}\""]
            ]}
          ]}
        ],
        verification: {
          stages: "standard",
          runs: { existing: [24, 24], generated: [0, 0], differential: [40, 40] },
          changedLineCoverage: 100,
          verified: [
            { id: "e1", title: "Existing test suite passes (24/24)", detail: "No previously passing test fails with the patch applied.", source: { kind: "test run", ref: "pytest -q tests/", log: "........................ 24 passed in 0.39s" } },
            { id: "e2", title: "Output identical to original on 40 inputs", detail: "Differential test compares format_invoice_line() before and after the patch.", highlight: "sig", source: { kind: "differential test (baseline vs patch)", ref: "tests/_gen/test_diff_invoice_line.py", log: "40 agree, 0 disagree" } },
            { id: "e3", title: "Type hints pass mypy", detail: "Static type check reports no new errors.", highlight: "sig", source: { kind: "static check", ref: "mypy shopkit/invoice.py", log: "Success: no issues found in 1 source file" } },
            { id: "e4", title: "Docstring claim checked", detail: "The docstring says rounding is half-up; round_money() uses ROUND_HALF_UP.", highlight: "doc", source: { kind: "static check", ref: "shopkit/pricing.py:4", log: "rounding=ROUND_HALF_UP" } }
          ],
          failed: [],
          unresolved: [],
          claimCheck: [
            { claim: "c1", status: "supported", note: "Differential test e2." },
            { claim: "c2", status: "supported", note: "24/24 in the sandbox." }
          ],
          assessment: { level: "low", text: "Low risk. The evidence covers the whole change." }
        }
      }
    }
  }
];

/* What the verification pipeline covers — shown to the user (Amershi G1/G2). */
const CAPABILITY = {
  checks: [
    "Runs your existing test suite on an isolated copy of the code",
    "Generates tests for the new behaviour (written by the assistant)",
    "Compares old vs new behaviour on sampled inputs (differential tests) when you request more tests",
    "Finds other code that calls the functions that changed",
    "Re-runs failing tests on the original code to spot flaky tests"
  ],
  doesNot: [
    "Know requirements you have not written down",
    "Prove the code is correct for all inputs",
    "Check performance, security, or external services",
    "Make the generated tests independent of the assistant"
  ]
};
