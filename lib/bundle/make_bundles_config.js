var util = require("util"),
	path = require("path");

module.exports = function(bundles, configuration){
	var paths = getBundlesPaths(configuration);
	
	var bundledBundles = bundles.slice(0);
	if(configuration.options.bundleSteal){
		bundledBundles.shift();
	}
	
	var bundlesConfig = {};
	bundledBundles.forEach(function(bundle){
		bundlesConfig[bundle.name] = bundle.nodes.map(function(node){
			return node.load.name;
		});
	});
	
	return {
		load: {name: "[system-bundles-config]"},
		minifiedSource: paths + "System.bundles = "+JSON.stringify(bundlesConfig)+";"
	};
};

// Get the System.paths needed to map bundles, if a different bundlesPath is provided.
function getBundlesPaths(configuration){
	// If a bundlesPath is not provided, the paths are not needed because they are
	// already set up in steal.js
	if(!configuration.loader.bundlesPath) {
		return "";
	}
	var bundlesPath = configuration.bundlesPathURL;

	// Get the dist directory and set the paths output
	var paths = util.format('System.paths["bundles/*.css"] ="%s/*css";\n' +
													'System.paths["bundles/*"] = "%s/*.js";\n',
													bundlesPath, bundlesPath);
	// TODO: we should probably give a warning to make sure you include this in your production html's configuration.
	return paths;
}