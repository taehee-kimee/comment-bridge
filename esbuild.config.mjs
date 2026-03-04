import esbuild from "esbuild";
import fs from "fs";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  target: "es2017",
  format: "iife",
};

fs.mkdirSync("dist", { recursive: true });
fs.copyFileSync("src/ui.html", "dist/ui.html");

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete.");
}
