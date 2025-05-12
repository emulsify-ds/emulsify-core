// Only lives inside this module
const importAll = (context) => {
  context.keys().forEach(context);
};

// Create the webpack context for your SVG folder
const iconsContext = require.context(
  '../../../../../assets/icons/',
  /* include sub-dirs */ true,
  /* match .svg */ /\.svg$/,
);

// Immediately import all SVGs into the sprite
importAll(iconsContext);
