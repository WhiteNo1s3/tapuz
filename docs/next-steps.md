# Next Steps for Tapuz

## Immediate Priorities (this session)

- [x] Document Hebrew + RTL as first-class requirement
- [x] Document CLI / Agent support as first-class requirement
- [ ] Decide backend technology
- [ ] Decide static generation vs server-rendered
- [ ] Design the Page + Block data model (critical)
- [ ] Create initial SQLite schema
- [ ] Pick a default RTL theme approach

## Questions to Answer Now

1. Backend: Node.js (confirmed)
2. Blocks: Structured data (confirmed)
3. Slugs: Hebrew preferred like `דף-הבית`, with option for English prefixes (e.g. `home-`)

4. **First block types** — What blocks do you think you'll need most at the beginning?

## Proposed First Build Order

1. Define clean JSON schema for Pages + Blocks
2. Set up SQLite database + basic migration
3. Create a small CLI tool (`tapuz`) that can create pages
4. Build a minimal public renderer that outputs proper RTL HTML
5. Add a very basic web admin (Hebrew UI)
6. Create the first RTL theme

Let's lock in the big choices and start coding.
