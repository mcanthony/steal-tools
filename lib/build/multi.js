/*

# lib/build/multi.js

The bundled build works by loading the _main_ module and all of its
dependencies and then all of the `System.bundle` modules 
and their dependencies. It makes a dependency graph that looks like:

```js
{
  moduleName: Node({
    load: Load({
      name: moduleName,
      source: SOURCE
    }),
    dependencies: [moduleName],
    bundles: [bundleName],
  })
}
```

Here's an example:

```js
{
  "jquery": {
    load: {
      name: "jquery",
      source: "jQuery = function(){ ... }"
    },
    dependencies: [],
    bundles: ["profile","settings","login", ...]
  },
  "can/util": {
    load: {
      name: "can/util",
      source: "define(['jquery'], function($){ ... })" 
    },
    dependencies: ["jquery"],
    bundles: ["profile","login"]
  }
}
```

A `Load` is a ES6 load record.

A `Node` is an object that contains the load and other 
useful information. The build tools only write to `Node` to keep `Load` from being changed.

It manipulates this graph and eventually creates "bundle" graphs.  Bundle graphs look like:

     {
       size: 231231,
       nodes: [node1, node2, ...],
       bundles: [bundleName1, bundleName2]	
     }
     
The nodes in those bundles are written to the filesystem.

*/
var winston = require('winston');

var makeBundleGraph = require("../graph/make_graph_with_bundles"),
	order = require("../graph/order"),
	transpile = require("../graph/transpile"),
	minifyGraph = require("../graph/minify"),
	pluck = require("../graph/pluck"),
	makeBundle = require("../bundle/make_bundle"),
	nameBundle = require("../bundle/name"),
	flattenBundle = require("../bundle/flatten"),
	writeBundles = require("../bundle/write_bundles"),
	makeBundlesConfig = require("../bundle/make_bundles_config"),
	splitByBuildType = require("../bundle/split_by_build_type"),
	pluckOnlyInBundle = require("../graph/pluck_only_in_bundle"),
	addStealToBundle = require("../bundle/add_steal"),
	_ = require("lodash"),
	logging = require("../logger"),
	hasES6 = require("../graph/has_es6"),
	addTraceurRuntime = require("../bundle/add_traceur_runtime"),
	makeConfiguration = require("../configuration/make");

module.exports = function(config, options){
	options = _.assign({ // Defaults
		minify: true,
		bundleSteal: false
	}, options);

	// Setup logging
	logging.setup(options);

	// Minification is optional
	var minify = options.minify !== false;

	// Get the merged dependency graphs for each System.bundle.
	return makeBundleGraph(config).then(function(data){
		var dependencyGraph = data.graph,
			baseURL = data.loader.baseURL,
			main = data.loader.main,
			hasES6modules = hasES6(dependencyGraph),
			configuration = makeConfiguration(data.loader, data.buildLoader, options);

		// Remove @config so it is not transpiled.  It is a global,
		// but we will want it to run ASAP.
		var stealconfig = pluck(dependencyGraph,"@config");
		// Remove steal dev from production builds.
		pluck(dependencyGraph,"@dev");
		
		// Adds an `order` property to each `Node` so we know which modules.  
		// The lower the number the lower on the dependency tree it is.
		// For example, jQuery might have `order: 0`.
		( data.loader.bundle || []).forEach(function(moduleName){
			order(dependencyGraph, moduleName);
		});
		
		// Transpile each module to amd. Eventually, production builds
		// should be able to work without steal.js.
		transpile(dependencyGraph, "amd");
		
		// Minify every file in the graph
		if(minify) {
			minifyGraph(dependencyGraph);
		}

		// Pull out the main module and its dependencies. They will be
		// in their own bundle.
		var stealConfigAndMain = stealconfig.concat( pluck(dependencyGraph, main) );
		
		pluckOnlyInBundle(dependencyGraph, main);
		
		// Create a master bundle with all the minified "main" modules.
		if(minify) {
			winston.info('Minifying...');
		}

		var masterNodes = minify ? minifyGraph( stealConfigAndMain ) : stealConfigAndMain;
		var masterBundle =  {
			nodes: masterNodes,
			bundles: [main]
		};

		// Put everything into unique bundle graphs that have no waste. The
		// modules are grouped by repeatedly taking the "most shared" set of
		// modules out of the dependency graph.  
		// The "most shared" set is the collection of modules that are shared 
		// by the most number of applications who's total minified length
		// is the largest.  Read more about this in `makeBundle`.
		var bundles = makeBundle(dependencyGraph);
		
		// It's possible that the number of bundles an endpoint would need to load
		// is quite large.  `flattenBundle` merges bundles to create
		// as little "waste" as possible. Waste means loading some modules that are not
		// needed.
		flattenBundle(bundles,config.bundleDepth || 3);
		
		var splitBundles = splitByBuildType(bundles),
			splitMaster = splitByBuildType([masterBundle]),
			// keep a reference to the master JS
			masterJS =  splitMaster[0];
		
		// Add the master to bundles so it will be written out
		splitBundles.unshift.apply( splitBundles, splitMaster );
		
		// Name each bundle so we know what to call the bundle.
		splitBundles.forEach(nameBundle);
		
		// Make config JS code so System knows where to look for bundles.
		var configNode = makeBundlesConfig(splitBundles, configuration );
		
		// add that config to the masterBundle
		masterJS.nodes.unshift(configNode);

		if(options.bundleSteal) {
			addStealToBundle(masterJS, main);
		}
		// Traceur code requires a runtime.
		if( hasES6modules ) {
			addTraceurRuntime(masterJS);
		}
		
		// Write bundles to the file system
		return writeBundles(splitBundles, configuration );
	}).catch(function(e){
		winston.error(e.message, e.stack);
	});
};