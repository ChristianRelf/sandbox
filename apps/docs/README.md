# sndbox documentation

This directory is a native Mintlify documentation project. `docs.json` owns navigation, appearance, redirects, OpenAPI generation, and the custom-domain configuration used after the repository is connected to Mintlify.

## Local development

The repository also contains React applications, so install the Mintlify CLI locally in this workspace to keep its React runtime isolated:

```powershell
cd apps/docs
npm install --workspaces=false --install-strategy=nested
npm run dev --workspaces=false
```

The preview opens at `http://localhost:3200`.

## Validation

```powershell
npm run build --workspaces=false
npm run check:links --workspaces=false
npm run check:a11y --workspaces=false
```

`build` runs `mint validate`. The other commands check internal links, anchors, redirects, and the rendered accessibility surface.

## Generated references

Run `npm run generate:references --workspaces=false` after changing the built-in node catalogue or OpenAPI source. `scripts/generate-docs-reference.ts` rebuilds all node pages from `src/catalogue.ts` and copies `docs/api/openapi-v1.json` into the Mintlify API reference.

Do not hand-edit files in `nodes/` or `api-reference/openapi.json`; change their source definitions and regenerate them instead.

## Deployment

Connect this repository to Mintlify with `apps/docs` as the documentation directory, then configure `docs.sndbox.app` as a Mintlify custom domain. Documentation is no longer built as a Docker image or proxied by the DigitalOcean Caddy service.
