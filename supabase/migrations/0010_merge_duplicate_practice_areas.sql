-- Merge two Governmental subgroups into the standalone practice areas they
-- duplicated. The tracker offered each practice twice, and split its rows:
--
--   White Collar Defense and Investigations              74 rows  (kept)
--   Governmental--White Collar Defense & Investigations  14 rows  (merged in)
--   Antitrust and Competition                             7 rows  (kept)
--   Governmental--Antitrust and Competition               5 rows  (merged in)
--
-- Figures verified live 2026-09-25. The standalone form survives because
-- it is the only one the nightly summarizer can write — it validates
-- against top-level names only (src/lib/federal-register/summarize.ts); the
-- subgroup tags came solely from the manual `npm run classify` script.
-- src/config/practice-areas.json drops both subgroups in the same commit.
--
-- Rows gain the standalone in place of the subgroup, or just lose the
-- subgroup if they somehow already carry the standalone, so no row can end
-- up with a tag twice. Idempotent: a second run matches nothing.
--
-- Six rows had no other Governmental tag, so they stop matching a
-- "Governmental" filter — accepted deliberately (Jason, 2026-09-25):
-- Governmental's own criteria are contracts, grants, procurement and agency
-- structure, which these do not fit.
--   bc2546f4-4eaa-4206-8a10-491d0ae0361b  Guaranteeing Fair Banking
--   dbc0857b-aa4e-4e2c-8040-684bc94c2dbb  Fair Competition in Livestock Markets
--   8fdb88a5-af91-428f-8621-fc61c6435bea  Pausing FCPA Enforcement
--   c2572015-ff5a-43fa-be32-d858cec5ca0b  Price Fixing and Anti-Competitive Conduct
--   067cdc46-cc59-410d-994c-6f3a689acb52  "Straw Donor" Investigation
--   ebcd4d08-10a5-45e4-a95e-b185dca65204  Protecting American Investors From Foreign-Owned ...
--
-- To undo, a later migration re-tags these 18 rows. White Collar subgroup:
-- bc2546f4, 72a58915, a9ca000d, c0ecee7c, 8d03b55a, 8e42c30a, 8fdb88a5,
-- 3206a3e7, a3797055, 067cdc46, 07e97485, 32678075, 94a91cd6, ebcd4d08.
-- Antitrust subgroup: dbc0857b, c2572015, 0373a671, 7cfbbaf8, ebcd4d08.

update executive_orders
set practice_areas = case
  when 'White Collar Defense and Investigations' = any(practice_areas)
    then array_remove(practice_areas, 'Governmental--White Collar Defense & Investigations')
  else array_replace(
    practice_areas,
    'Governmental--White Collar Defense & Investigations',
    'White Collar Defense and Investigations'
  )
end
where 'Governmental--White Collar Defense & Investigations' = any(practice_areas);

update executive_orders
set practice_areas = case
  when 'Antitrust and Competition' = any(practice_areas)
    then array_remove(practice_areas, 'Governmental--Antitrust and Competition')
  else array_replace(
    practice_areas,
    'Governmental--Antitrust and Competition',
    'Antitrust and Competition'
  )
end
where 'Governmental--Antitrust and Competition' = any(practice_areas);
