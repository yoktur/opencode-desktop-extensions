import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import solid from "vite-plugin-solid";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/extensions", { recursive: true });
await mkdir("dist/builtin", { recursive: true });
await mkdir("dist/.entries", { recursive: true });

await build({
  configFile: false,
  plugins: [solid()],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: {
        index: "src/index.ts",
        main: "src/main.ts",
        solid: "src/solid.tsx",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web"],
    },
  },
});

await Bun.write(
  "dist/runtime.js",
  await bundle("src/runtime.ts", "OCDXRuntime"),
);
await buildExtension("builtin/extension-manager", [], "dist/builtin");
await buildExtension("examples/subway-surfers", ["assets/subway-surfers.webm"]);
await buildExtension("examples/vertical-tabs", []);
await buildExtension("examples/keep-awake", []);
await rm("dist/.entries", { recursive: true, force: true });

async function buildExtension(
  directory: string,
  assets: string[],
  output = "dist/extensions",
) {
  const manifest = await Bun.file(`${directory}/manifest.json`).json();
  if (
    manifest.schema !== 1 ||
    !manifest.id ||
    manifest.entry !== "renderer.js" ||
    (manifest.main !== undefined && manifest.main !== "main.cjs")
  ) {
    throw new Error(`Invalid extension manifest: ${directory}/manifest.json`);
  }

  const renderer = await bundleExtension(directory, manifest);
  const main = manifest.main
    ? await bundleMainExtension(directory, manifest)
    : undefined;

  const writer = new ZipWriter(new BlobWriter("application/vnd.ocdx"));
  await writer.add(
    "manifest.json",
    new TextReader(JSON.stringify(manifest, null, 2)),
  );
  await writer.add("renderer.js", new TextReader(renderer));
  if (main) await writer.add("main.cjs", new TextReader(main));
  for (const asset of assets) {
    const file = Bun.file(`${directory}/${asset}`);
    if (
      (await file.slice(0, 128).text()).startsWith(
        "version https://git-lfs.github.com/spec/v1",
      )
    ) {
      throw new Error(`Git LFS asset is missing: ${directory}/${asset}`);
    }
    await writer.add(asset, new BlobReader(file), {
      level: 0,
    });
  }
  await Bun.write(`${output}/${manifest.id}.ocdx`, await writer.close());
}

async function bundle(entry: string, name: string) {
  const result = await build({
    configFile: false,
    plugins: [solid()],
    build: {
      target: "esnext",
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: {
        entry,
        name,
        formats: ["iife"],
        fileName: () => "renderer.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (value) => ("output" in value ? value.output : []),
  );
  const renderer = outputs.find(
    (value) => value.type === "chunk" && value.fileName === "renderer.js",
  );
  if (!renderer || renderer.type !== "chunk") {
    throw new Error(`Vite did not bundle ${entry}`);
  }
  return renderer.code;
}

async function bundleExtension(
  directory: string,
  manifest: { id: string; name: string },
) {
  const source = resolve(`${directory}/index.tsx`).replaceAll("\\", "/");
  const entry = resolve(`dist/.entries/${manifest.id}.ts`);
  await Bun.write(
    entry,
    `
      import extension from ${JSON.stringify(source)};
      import { registerExtension } from "@hona/ocdx";
      registerExtension(extension, ${JSON.stringify({ id: manifest.id, name: manifest.name })});
    `,
  );
  return bundle(entry, "OCDXExtension");
}

async function bundleMainExtension(
  directory: string,
  manifest: { id: string },
) {
  const source = resolve(`${directory}/main.ts`).replaceAll("\\", "/");
  const result = await build({
    configFile: false,
    build: {
      target: "node22",
      write: false,
      lib: {
        entry: source,
        formats: ["cjs"],
        fileName: () => "main.cjs",
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          exports: "named",
          inlineDynamicImports: true,
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (value) => ("output" in value ? value.output : []),
  );
  const main = outputs.find(
    (value) => value.type === "chunk" && value.fileName === "main.cjs",
  );
  if (!main || main.type !== "chunk") {
    throw new Error(`Vite did not bundle the main entry for ${manifest.id}`);
  }
  return main.code;
}
