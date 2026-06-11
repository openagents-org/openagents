# Publishing a Blog Post to OpenAgents Blog

## Repository

Blog lives in the **openagents-web** repo at:
```
/home/raphaelshu/.conda/packages/openagents-web
```

Remote: `git@github.com:acenta-ai/openagents-web.git`, branch `develop`.

## Blog Post Location

```
blog_frontend/content/blog/
```

## File Format

MDX files named `YYYY-MM-DD-slug-title.mdx`.

### Frontmatter

```yaml
---
title: "Post Title"
publishedAt: "YYYY-MM-DD"
summary: "One-line summary for listing cards"
category: "Features"
image: "/images/blog/optional-hero.png"     # optional
author: "Author Name"                        # optional
---
```

**Categories:** `Announcements`, `Tutorials`, `Features`, `Guides`, `Demos`, `News`

### Content

Standard GitHub-flavored Markdown. Supports:
- Code blocks with syntax highlighting (theme: one-dark-pro)
- Tables
- Headings auto-generate anchor IDs
- Images from `/public/images/blog/`

## Publishing Steps

1. **Create the MDX file** in `blog_frontend/content/blog/`
2. **Commit and push to `develop`**:
   ```bash
   cd /home/raphaelshu/.conda/packages/openagents-web
   git add blog_frontend/content/blog/YYYY-MM-DD-slug.mdx
   git commit -m "blog: short description"
   git push origin develop
   ```
3. The site auto-deploys from `develop`.

## Post URL

```
https://openagents.org/blog/posts/<slug>
```

Where `<slug>` is the full filename minus the `.mdx` extension (**including the date prefix**).

Example: `2026-05-25-how-we-cut-agent-response-latency-in-half.mdx` →
`https://openagents.org/blog/posts/2026-05-25-how-we-cut-agent-response-latency-in-half`

## Announcing to Lark MKT Channel

Use `lark-cli` to post to the **OpenAgents MKT Internal** group:

```bash
/home/raphaelshu/.openagents/nodejs/bin/lark-cli im +messages-send \
  --as bot \
  --chat-id oc_ad6a7392db281753af0c632d721ba226 \
  --markdown '**New Blog Post Published**

[Post Title](https://openagents.org/blog/posts/<slug>)

Brief description of the post.'
```

- Use `--as bot` (bot app ID: `cli_aa8ef0916ef85e15`)
- Chat ID for MKT Internal: `oc_ad6a7392db281753af0c632d721ba226`
- `--format` flag is NOT supported on `+messages-send`
