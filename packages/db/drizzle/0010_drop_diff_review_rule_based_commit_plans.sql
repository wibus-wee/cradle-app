DELETE FROM `diff_review_commit_plans`
WHERE `strategy` IN ('single', 'rule-based-groups');
