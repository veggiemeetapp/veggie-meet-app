# WO-150 — Community Places capitalization

## Scope
- Audit every user-facing occurrence of “community places” and classify formal product/category labels separately from ordinary prose.
- Change the Community heading to **Community Places nearby** without altering layout, icon, action, data, or behavior.
- Correct any other section, navigation, category, or accessibility label only when it clearly names the formal **Community Places** category.
- Do not touch WO-151, backend behavior, location behavior, or the certified PWA update lifecycle.

## Verification
- Add or update focused regression coverage for the corrected label.
- Verify accessibility semantics remain unchanged.
- Run relevant tests, the full test suite, typecheck, production build, and service-worker checks.
- Check 320, 390, 430, 768, and 1280 widths for zero unintended horizontal overflow; capture the required 390px proof.

## Publication and evidence
- Preserve a pre-change production screenshot, then publish only after every gate passes.
- Verify the live production copy, action alignment, release/version behavior, and absence of browser or HTTP errors.
- Store `community-before.png`, `community-after.png`, and `community-mobile-390.png` under `/mnt/documents/wo150/evidence/`.
- Create `/mnt/documents/wo150/WO-150-CLOSEOUT.md` with the audit, exact changed strings/files, test totals, responsive/accessibility results, publication record, and final status.
