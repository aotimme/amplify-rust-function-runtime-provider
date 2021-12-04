import path from 'path';

import {
  BuildType,
} from 'amplify-function-plugin-interface';
import execa from 'execa';

import { CARGO_CMD, TARGET_PATH_DEV, TARGET_PATH_PROD } from './constants';

export const getBuildBinaryPath = async (rustSrcDir: string, buildType: BuildType): Promise<string> => {
  const binName = await getBuildBinaryName(rustSrcDir);
  const targetDir = buildType == BuildType.PROD ? TARGET_PATH_PROD : TARGET_PATH_DEV;
  return path.join(rustSrcDir, targetDir, binName);
};

const getBuildBinaryName = async (rustSrcDir: string): Promise<string> => {
  const output = await execa(CARGO_CMD, ['read-manifest'], {cwd: rustSrcDir});
  if (output.exitCode !== 0) {
    throw new Error(`cargo read-manifest failed, exit code was ${output.exitCode}`);
  }
  const manifest = JSON.parse(output.stdout.toString()) as CargoManifest;
  const binTargets = manifest.targets.filter((target) => target.kind.some((kind) => kind === 'bin'));
  if (binTargets.length !== 1) {
    throw new Error(`Found ${binTargets.length} targets of type bin, expected exactly 1`)
  }
  return binTargets[0].name;
};


// there are more fields, but we really only care about `targets`
type CargoManifest = {
  name: string,
  version: string
  targets: {
    kind: string[],
    crate_types: string[],
    name: string,
    src_path: string,
    edition: string,
    doc: boolean,
    doctest: boolean,
    test: boolean,
  }[],
}