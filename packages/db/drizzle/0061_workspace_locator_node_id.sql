UPDATE `workspaces`
SET `locator_json` = json_set(
  json_remove(`locator_json`, '$.hostId'),
  '$.nodeId',
  json_extract(`locator_json`, '$.hostId')
)
WHERE json_type(`locator_json`, '$.hostId') IS NOT NULL;
