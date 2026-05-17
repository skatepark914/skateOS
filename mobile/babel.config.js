// Babel config — drawer navigator + reanimated animations need this
// plugin so the worklets compile. react-native-reanimated/plugin MUST
// be listed LAST in the plugins array.
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
