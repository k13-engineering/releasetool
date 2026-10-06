import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";

// Creates a temporary directory containing the given files. Keys are paths
// relative to the directory, values the file contents.
const createTempProject = ({ files }: { files: Record<string, string> }): string => {
  const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "releasetool-test-"));

  Object.entries(files).forEach(([filePath, content]) => {
    const absoluteFilePath = nodePath.join(directory, filePath);
    nodeFs.mkdirSync(nodePath.dirname(absoluteFilePath), { recursive: true });
    nodeFs.writeFileSync(absoluteFilePath, content);
  });

  return directory;
};

const removeTempProject = ({ directory }: { directory: string }) => {
  nodeFs.rmSync(directory, { recursive: true, force: true });
};

// Lists all files below the given directory as sorted relative paths.
const listFiles = ({ directory }: { directory: string }): string[] => {
  return nodeFs.readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => {
    return entry.isFile();
  }).map((entry) => {
    return nodePath.relative(directory, nodePath.join(entry.parentPath, entry.name));
  }).toSorted();
};

export {
  createTempProject,
  listFiles,
  removeTempProject
};
