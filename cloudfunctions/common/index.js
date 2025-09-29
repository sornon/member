// Common shared utilities placeholder for cloud function deployments.
//
// Some deployment pipelines upload a "common" cloud function to host
// shared code or npm dependencies. If the directory is missing or empty
// the first deployment may fail, leaving the function in a CreateFailed
// state that blocks subsequent updates. Providing a minimal handler keeps
// the function in a healthy state while still making it clear that this
// endpoint is not intended to be invoked directly.

exports.main = async () => ({
  message: 'Common utility function placeholder – no runtime logic implemented.'
});
