type TPackageJson = Record<string, unknown>;

const mergePackageJson = ({
  localPackageJson,
  npmPackageJson
}: {
  localPackageJson: TPackageJson,
  npmPackageJson: TPackageJson
}): TPackageJson => {

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

const patchPackageJsonVersion = ({
  packageJson,
  versionTag
}: {
  packageJson: TPackageJson,
  versionTag: string
}): TPackageJson => {

  if (!versionTag.startsWith("v")) {
    throw Error(`version string must start with 'v', got "${versionTag}"`);
  }

  const version = versionTag.slice(1);

  const { version: oldVersion, ...rest } = packageJson;

  return {
    version,
    ...rest
  };
};

export {
  mergePackageJson,
  patchPackageJsonVersion
};

export type {
  TPackageJson
};
