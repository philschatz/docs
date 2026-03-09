// Initialize Subduction module for automerge-repo (required since subduction integration)
const subductionModule = require('@automerge/automerge-subduction');
const { setSubductionModule } = require('@automerge/automerge-repo');
setSubductionModule(subductionModule);
