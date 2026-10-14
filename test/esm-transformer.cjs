const ts = require('typescript');
module.exports = {
  process(source, filename) {
    return {
      code: ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          allowJs: true,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
    };
  },
};
