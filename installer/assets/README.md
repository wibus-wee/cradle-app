# DMG Artwork

`dmg-background.svg` is the source artwork for the installer window. It uses a flat rounded illustration of a Cradle box, with the left side carrying the brand message and the right side reserved for the installer files.

`dmg-hero-prompt.md` documents the same visual direction for future raster explorations. Generated artwork should remain flat and illustrative; text and the final file placement belong in the SVG/appdmg composition.

The PNG files are generated from the SVG source with macOS `sips`:

```sh
sips -s format png dmg-background.svg --out dmg-background@2x.png
sips -Z 660 dmg-background@2x.png --out dmg-background.png
```
