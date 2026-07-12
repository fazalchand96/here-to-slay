# Premium Tavern Tabletop Skin Assets

Generated with the built-in image generation tool for the Premium Tavern Tabletop redesign.

## Board Backgrounds

- `premium-tabletop-landscape.png` - landscape board surface with carved zones.
- `premium-tabletop-portrait.png` - portrait board surface with vertical mobile zones.

## Source Sheets

- `card-backs-sheet.png` - 2x2 sheet:
  - main deck back
  - monster deck back
  - hidden/opponent card back
  - party leader back
- `card-frames-sheet.png` - 3x2 sheet:
  - Hero
  - Monster
  - Magic
  - Item
  - Modifier
  - Challenge
- `button-blanks-sheet.png` - 4x3 sheet of no-text button blanks:
  - brass primary
  - blue draw/action
  - amber reload
  - red danger/end
  - green confirm
  - disabled/dark
  - icon/menu/secondary/cancel variants
- `material-textures-sheet.png` - 4x2 material sheet:
  - walnut
  - parchment
  - brass
  - leather
  - monster leather
  - blue enamel
  - emerald leather/felt
  - blackened iron
- `ui-icons-sheet.png` - 5x4 icon/ornament sheet:
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
