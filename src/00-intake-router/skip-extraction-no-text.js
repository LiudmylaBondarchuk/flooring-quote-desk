return $input.all().map((item, i) => ({
  json: { output: {}, skipped_extraction: true },
  pairedItem: { item: i },
}));