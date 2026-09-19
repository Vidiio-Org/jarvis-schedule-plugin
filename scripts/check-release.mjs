// Release gate: fails (exit 1) when the plugin would be rejected by the marketplace checks.
// Usage: node scripts/check-release.mjs [tag]   (tag defaults to $GITHUB_REF_NAME, e.g. v0.2.0)
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const pkg = read('package.json');
const manifest = read('ade.plugin.json');
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

const problems = [];
if (tag && tag !== `v${pkg.version}`) problems.push(`tag ${tag} does not match package.json version ${pkg.version}`);
if (manifest.version !== pkg.version) problems.push(`ade.plugin.json version ${manifest.version} does not match package.json ${pkg.version}`);
if (pkg.private === true) problems.push('package.json has "private": true (npm publish would refuse it)');
if (Object.keys(pkg.dependencies ?? {}).length > 0) problems.push('package.json has runtime "dependencies" (the installer is copy-only)');
for (const hook of ['preinstall', 'install', 'postinstall']) {
  if (pkg.scripts?.[hook]) problems.push(`package.json defines the "${hook}" script`);
}
if (!(pkg.keywords ?? []).includes('jarvis-ade-plugin')) problems.push('package.json keywords must include "jarvis-ade-plugin"');
if (!/github\.com[/:]Vidiio-Org\/jarvis-schedule-plugin/i.test(JSON.stringify(pkg.repository ?? ''))) problems.push('package.json repository must point at the GitHub repo');
if (!(pkg.files ?? []).includes('ade.plugin.json')) problems.push('package.json "files" must include ade.plugin.json');
if ((pkg.files ?? []).some((f) => /^(dev|test|scripts)(\/|$)/.test(f) || f === 'ui/dev')) problems.push('package.json "files" must not ship dev/, test/ or scripts/');

if (problems.length > 0) {
  console.error(`check-release failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-release ok: ${pkg.name}@${pkg.version} (manifest id ${manifest.id})`);
