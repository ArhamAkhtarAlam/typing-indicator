// node tests/windows/read-asar.mjs <app.asar>
// Reads the tiny app.asar install-prebuilt.ps1 wrote, with Electron's own asar library, and prints JSON:
// { files, main, patcherPath } (patcherPath = the path index.js require()s, as JavaScript would read it)
import { extractFile, listPackage } from "@electron/asar";

const archive = process.argv[2];
const files = listPackage(archive, { isPack: false }).map(f => f.replace(/^[\\/]/, ""));
const pkg = JSON.parse(extractFile(archive, "package.json").toString());
const index = extractFile(archive, "index.js").toString();
const m = index.match(/^require\(("(?:[^"\\]|\\.)*")\);\s*$/);
// plain ASCII output: Windows PowerShell 5.1 reads node's output in the console's code page, not UTF-8
const json = JSON.stringify({ files, main: pkg.main, patcherPath: m ? JSON.parse(m[1]) : null, index });
console.log(json.replace(/[\u0080-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
