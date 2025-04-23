const mergePackageJson = ({
  localPackageJson,
  npmPackageJson
}: {
  localPackageJson: Record<string, unknown>,
  npmPackageJson: Record<string, unknown>
}) => {

  const merged = {
    ...localPackageJson,
    ...npmPackageJson
  };

  // although ordering of fields is not guaranteed,
  // we do this in order to tidy up the output for now

  return {
    name: merged.name,
    type: merged.type,
    version: merged.version,
    description: merged.description,
    files: merged.files,
    main: merged.main,
    ...merged
  };
};

export {
  mergePackageJson
};
