# Atlas of Dante’s Divine Comedy

A beginner-friendly, static digital humanities map built with HTML, CSS, JavaScript, Leaflet, and Papa Parse. It needs no API key, database, or build step and is ready for GitHub Pages.

## Preview the site on your computer

Because browsers protect local files, opening `index.html` directly may stop the CSV from loading. The easiest preview is GitHub Pages after publishing. If you already use a simple local web server, serve this folder and open its local address instead.

## Update the data

1. Open the `data` folder.
2. Replace `dante_places.csv` with your updated CSV.
3. Keep the filename exactly `dante_places.csv`.
4. Keep the existing column names. You may add extra columns; the site will ignore them.
5. Commit and push the new CSV to GitHub.

Rows with valid latitude and longitude appear on the map. Every row appears in the Library, including rows without coordinates.

## Publish with GitHub Pages

1. Create a GitHub repository and upload everything in this folder, including `.nojekyll` and the `data` folder.
2. In the repository, choose **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your main branch and the `/ (root)` folder, then save.
5. GitHub will show the public website address after it finishes publishing.

The site uses relative paths, so it works at an address such as `https://USERNAME.github.io/REPOSITORY-NAME/` without editing the code.

## Easy visual changes

The main colors are listed at the top of `style.css` under `:root`. Edit those values to adjust the burgundy, parchment, ochre, or gold palette.

The map begins near Italy. To change the opening view, edit `DEFAULT_VIEW` and `DEFAULT_ZOOM` near the top of `script.js`.

## Internet connection

The website is static, but visitors need an internet connection to load Leaflet, Papa Parse, and the CARTO/OpenStreetMap map tiles.
