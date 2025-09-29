// Shared module wrapper for Tencent Cloud Functions.
//
// The shared function exists so that the deployment tooling can create a
// valid serverless function package even when the repository only ships
// reusable libraries. Having a minimal entry point prevents the Tencent
// Cloud API from keeping the function in a CreateFailed status when the
// package is empty.

exports.main = async () => ({
  message: 'Shared module placeholder – this function is only used to host shared code.'
});
