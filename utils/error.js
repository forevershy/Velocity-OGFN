// Helper to send Epic-style error payloads.
function sendError(res, status, errorCode, errorMessage, numericErrorCode, messageVars = []) {
  return res.status(status).json({
    errorCode,
    errorMessage,
    messageVars,
    numericErrorCode,
    originatingService: "any",
    intent: "prod",
  });
}

module.exports = {
  sendError,
  notFound: (res) =>
    sendError(
      res,
      404,
      "errors.com.epicgames.common.not_found",
      "Sorry, the resource you were trying to find could not be found.",
      1004
    ),
};
