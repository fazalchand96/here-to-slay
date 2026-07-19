# Premium Tavern Tabletop Skin Assets

Generated with the built-in image generation tool for the Premium Tavern Tabletop redesign.

## Board Backgrounds

- `premium-tabletop-landscape.webp` - landscape board surface with carved zones.
- `premium-tabletop-portrait.webp` - portrait board surface with vertical mobile zones.
- `premium-tabletop-landscape-ap1-v80.webp` through `premium-tabletop-landscape-ap4-v80.webp` - full landscape board image edits with 1-4 AP gems lit.
- `premium-tabletop-portrait-ap1-v80.webp` through `premium-tabletop-portrait-ap4-v80.webp` - full portrait board image edits with 1-4 AP gems lit.

## Source Sheets

- `card-backs-sheet.webp` - 2x2 sheet:
  - main deck back
  - monster deck back
  - hidden/opponent card back
  - party leader back
- `card-frames-sheet.webp` - 3x2 sheet:
  - Hero
  - Monster
  - Magic
  - Item
  - Modifier
  - Challenge
- `button-blanks-sheet.webp` - 4x3 sheet of no-text button blanks:
  - brass primary
  - blue draw/action
  - amber reload
  - red danger/end
  - green confirm
  - disabled/dark
  - icon/menu/secondary/cancel variants
- `material-textures-sheet.webp` - 4x2 material sheet:
  - walnut
  - parchment
  - brass
  - leather
  - monster leather
  - blue enamel
  - emerald leather/felt
  - blackened iron
- `ui-icons-sheet.webp` - 5x4 icon/ornament sheet:
  - AP gems
  - roll/slay badges
  - class crest blanks
  - deck/discard medallions
  - action icons
  - menu/sound/close ornaments

## Next Step

The source sheets have been cropped into production folders:

- `cards/` - individual card backs.
- `frames/` - individual card-frame source crops.
- `buttons/` - individual blank button crops.
- `icons/` - individual icon/ornament crops.
- `textures/` - individual material texture crops.

Keep text labels and most button states in HTML/CSS for accessibility and responsive sizing.
Use cropped image assets for decorative backs, icons, texture fills, and optional frame overlays.
