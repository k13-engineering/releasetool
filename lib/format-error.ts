const formatError = ({ error }: { error: unknown }): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error.cause === undefined) {
    return error.message;
  }

  return `${error.message}\n  caused by: ${formatError({ error: error.cause })}`;
};

export {
  formatError
};
