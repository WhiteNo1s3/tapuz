# Tapuz Requirements

## Must Be True

- The public-facing website is delivered as clean, semantic HTML + CSS + minimal JS
- **RTL (Right-to-Left) is first-class** — Hebrew is the primary language
- Every page is fully responsive (mobile-first)
- The system has a secure admin area (auth required)
- Content is stored in a proper database (not just flat files for the CMS part)
- Media can be uploaded and attached to pages
- Pages support tags
- Themes are modular and follow a defined standard
- **Excellent CLI + agent support** — easy to build/edit content programmatically (Claude, OpenClaw, scripts, etc.)
- It should be possible to export a fully static version of the site

## Anti-Requirements (Things We Explicitly Don't Want)

- Heavy frontend frameworks on the public site
- Paying for page builder plugins
- Bloat like Elementor
- Vendor lock-in
- Complex build steps just to view the site

## User Goals

- Move away from WordPress + Elementor
- Have more control and ownership
- Build beautiful pages with focus (not fighting the tool)
- Create a reusable theme system
- Keep performance high

## Questions for You

1. What parts of your current WordPress site are most important to replicate first?
2. Do you want the site to be mostly static (generated files) or lightly dynamic (small server)?
3. How visual do you want the page builder to feel in the beginning?
4. Any strong preference on backend language (Node.js, PHP, Python, etc.)?
