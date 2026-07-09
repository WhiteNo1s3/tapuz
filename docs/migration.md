# WordPress → Tapuz Migration (Easy Mode)

You are already logged into your WordPress:  
**https://<wp-sandbox>/wp-admin/**

## Step 1: Export your content (do this now)

1. In your WP admin, go to:
   **Tools → Export**

2. Select:
   - **All content** (recommended first time)
   - Or just **Pages** if you want to start small

3. Click **Download Export File**

4. The file will be something like:
   `white-no1se.wordpress.2026-07-08.xml`

Save it somewhere easy, for example:
- `~/Downloads/white-no1se.xml`

## Step 2: Import into Tapuz

Run this command:

```bash
cd projects/tapuz

./bin/tapuz.js import-wp ~/Downloads/white-no1se.xml
```

Or if you want more output:

```bash
node scripts/migrate-wp.js ~/Downloads/white-no1se.xml
```

## What the importer currently does well

- Converts headings → `hero` or `heading` blocks
- Paragraphs → `text` blocks
- Images → `image` blocks
- Basic lists and quotes
- Uses Hebrew slugs when possible
- Skips pages that already exist

## After import

```bash
# See what came in
./bin/tapuz.js list-pages

# Build the static site
./bin/tapuz.js build

# Preview locally
./bin/tapuz.js serve 8080
```

## Important Notes about your site

Your site uses **Elementor**. Elementor often stores a lot of content in special meta fields, not just the normal post content. 

This means:
- Some pages may import with less content than expected
- Complex layouts may come in as plain text

**Best workflow**:
1. Import everything
2. Run `./bin/tapuz.js build`
3. Go through the important pages in the admin and clean them up / recreate nice blocks

Would you like me to:
- Improve the importer to handle more Elementor patterns?
- Add a "force re-import" option?
- Create a better admin editing experience so cleanup is faster?

Just drop the export file path here when you have it and I'll run the migration.