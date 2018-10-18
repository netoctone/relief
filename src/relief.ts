import ts = require('typescript');
import fs = require('fs');
import path = require('path');
import glob = require('glob');

interface ReducerContext {
  reducer: string;
}

interface ActionContext extends ReducerContext {
  action: string;
}

type AST = any[];
type ActionData = [string, string, string, string, string]; // [actionName, payloadType, body, actionType, actionTypeText]
type FieldData = [string, string, string]; // [name, type, initialValue]
type ImportData = [string, string[]]; // [importStatement, importNames, importPath]

interface WalkData {
  ast: AST;
  reducer?: string;
  actions?: ActionData[];
  fields?: FieldData[];
  imports?: ImportData[];
  statements?: string[]; // other top-level statements
}

glob(`${process.argv[2] || 'src'}/**/*.rts`, {}, (er, files) => {
  files.forEach(transpileFile)
});

function transpileFile(file): void {
  const source = fs.readFileSync(file).toString();
  const sc = ts.createSourceFile('tmp/x.ts', source, ts.ScriptTarget.ES5);

  function addChildWalkData(parent: WalkData, child: WalkData): WalkData {
    const ast = parent.ast || [];
    if (!Array.isArray(ast[ast.length-1])) {
      ast.push([]);
    }
    ast[ast.length-1].push(child.ast);
    return {
      ast,
      reducer: parent.reducer || child.reducer,
      actions: [].concat(parent.actions || [], child.actions || []),
      fields: [].concat(parent.fields || [], child.fields || []),
      imports: [].concat(parent.imports || [], child.imports || []),
      statements: [].concat(parent.statements || [], child.statements || [])
    };
  }

  function getNodeText(node: ts.Node): string {
    return source.substring(node.pos, node.end).trim();
  }

  function getName(node: ts.ClassDeclaration | ts.MethodDeclaration | ts.PropertyDeclaration | ts.ParameterDeclaration): string {
    if (node.name) {
      return getIdentifierName(node.name);
    } else {
      return '';
    }
  }

  function getIdentifierName(name: ts.PropertyName | ts.BindingName): string {
    if (name.kind === ts.SyntaxKind.StringLiteral) {
      return (name as ts.StringLiteral).text;
    }
    if (name.kind === ts.SyntaxKind.Identifier) {
      return (name as ts.Identifier).text;
    }
    return '';
  }

  function getPayloadType(decl: ts.MethodDeclaration) {
    if (decl.type) {
      return getNodeText(decl.type);
    } else {
      return 'any';
    }
  }

  function pascalToCamel(str: string): string {
    return str.replace(/^(.)/, ch => ch.toLowerCase());
  }

  function pascalToUnderscore(str: string): string {
    return str.replace(/(?:^|\.?)([A-Z])/g, (x,y) => '_' + y).replace(/^_/, '').toUpperCase();
  }

  function pascalToLowerHyphen(str: string): string {
    return str.replace(/(?:^|\.?)([A-Z])/g, (x,y) => '-' + y).replace(/^-/, '').toLowerCase();
  }

  function pascalToWords(str: string): string {
    return str.replace(/(?:^|\.?)([A-Z])/g, (x,y) => ' ' + y).replace(/^ /, '');
  }

  function pascalToLowerWords(str: string): string {
    return pascalToWords(str).toLowerCase();
  }

  function walkReducerMethodDecl(c: ActionContext, decl: ts.MethodDeclaration): WalkData {
    const defaultActionType = pascalToUnderscore(c.action);
    const defaultActionTypeText = `'[${pascalToWords(c.reducer)}] ${pascalToLowerWords(c.action)}'`;
    const payloadType = getPayloadType(decl);
    if (!decl.body) {
      throw `${c.action} does not have a function body`;
    }
    const fnBody = decl.body.statements.map(st => getNodeText(st)).join('\n');
    const resPrefix: string[] = [c.action, payloadType, fnBody];
    let res: string[];

    if (decl.parameters.length === 1) {
      const param = decl.parameters[0];
      const name = getName(param);
      if (param.initializer) {
        res = resPrefix.concat([name, getNodeText(param.initializer)]);
      } else {
        res = resPrefix.concat([name, defaultActionTypeText]);
      }
    } else {
      res = resPrefix.concat([defaultActionType, defaultActionTypeText]);
    }

    return {
      actions: [res as ActionData],
      ...genAST(decl)
    };
  }

  function walkReducerPropertyDecl(decl: ts.PropertyDeclaration): WalkData {
    const name = getName(decl);
    return {
      fields: [[name, getNodeText(decl.type), decl.initializer ? getNodeText(decl.initializer) : ''] as FieldData],
      ...genAST(decl)
    };
  }

  function walkReducerClassMember(c: ReducerContext, node: ts.ClassElement): WalkData {
    const res = genAST(node);

    switch (node.kind) {
      case ts.SyntaxKind.PropertyDeclaration:
        return addChildWalkData(
          res,
          walkReducerPropertyDecl(node as ts.PropertyDeclaration)
        );
      case ts.SyntaxKind.MethodDeclaration:
        const name = getName(node as ts.MethodDeclaration);
        return addChildWalkData(
          res,
          walkReducerMethodDecl({ ...c, action: name }, node as ts.MethodDeclaration)
        );
      default:
        return res;
    }
  }

  function genAST(node: ts.Node): WalkData {
    return {
      ast: [ts.SyntaxKind[node.kind], node.pos, node.end]
    };
  }

  function getImportedNames(decl: ts.ImportDeclaration): string[] {
    if (decl.importClause && decl.importClause.name) {
      return [getNodeText(decl.importClause.name)];
    }

    if (decl.importClause && decl.importClause.namedBindings) {
      const node = decl.importClause.namedBindings;
      switch (node.kind) {
        case ts.SyntaxKind.NamespaceImport:
          return [getNodeText((node as ts.NamespaceImport).name)];
        case ts.SyntaxKind.NamedImports:
          return (node as ts.NamedImports).elements.map(el => getNodeText(el.name));
      }
    }

    return [];
  }

  function walkImport(decl: ts.ImportDeclaration): WalkData {
    return {
      imports: [[getNodeText(decl), getImportedNames(decl)]],
      ...genAST(decl)
    };
  }

  function walkSyntaxListItem(node: ts.Node): WalkData {
    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
        const context = {
          reducer: getName(node as ts.ClassDeclaration)
        };
        return (node as ts.ClassDeclaration)
          .members
          .map(member => walkReducerClassMember(context, member as ts.ClassElement))
          .reduce(addChildWalkData, {
            ...context,
            ...genAST(node)
          });
      case ts.SyntaxKind.ImportDeclaration:
        return walkImport(node as ts.ImportDeclaration);
      default:
        return {
          statements: [getNodeText(node)],
          ...genAST(node)
        };
    }
  }

  function walk(node: ts.Node): WalkData {
    switch (node.kind) {
      case ts.SyntaxKind.SyntaxList:
        return node
          .getChildren()
          .map(walkSyntaxListItem)
          .reduce(addChildWalkData, genAST(node));
      default:
        let children;
        try {
          children = node.getChildren();
        } catch(e) {
          children = [];
        }
        return children.map(walk).reduce(addChildWalkData, genAST(node));
    }
  }

  const {
    reducer,
    actions,
    fields,
    imports,
    statements
  } = walk(sc);

  const initialFields = fields.filter(field => field[2]);
  const actionImports = imports.filter(([importStatement, importNames]) =>
    importNames.some(name =>
      actions.some(([actionName, payloadType]) =>
        payloadType.startsWith(name)
      )
    )
  );

  const stateClass = `${reducer}State`;

  function printActionType([actionName, payloadType, body, actionType, actionTypeText]: ActionData): string {
    return `${actionType}: ${actionTypeText}`;
  }

  function printAction([actionName, payloadType, body, actionType]: ActionData): string {
    return `export class ${actionName}Action implements Action {
  public type: string = ${reducer}Types.${actionType};
  constructor(public payload${payloadType === 'any' ? '?' : ''}: ${payloadType}) {}
}`;
  }

  function printActionReducerCase([actionName, payloadType, body, actionType]: ActionData): string {
    return `    case ${reducer}Types.${actionType}:
      ${body.split('\n').join('\n  ')}\n`;
  }

  function printField([name, type]: FieldData): string {
    return `  ${name}: ${type};`;
  }

  function printFieldInitial([name, type, initialValue]: FieldData): string {
    return `  ${name}: ${initialValue}`;
  }

  const actionImportStatements = [`import { Action } from '@ngrx/store';`].concat(
    actionImports.map(([statement]: ImportData) => statement)
  );

  const actionsSource = `${actionImportStatements.join('\n')}

export const ${reducer}Types = {
  ${actions.map(printActionType).join(',\n  ')}
}

${actions.map(printAction).join('\n\n')}

export type ${reducer}Actions =
  | ${actions.map(([actionName]: ActionData) => actionName + 'Action').join('\n  | ')};`;
  // actionsSource

  const reducerSource = `${imports.map(([statement]: ImportData) => statement).join('\n')}

${statements.join('\n\n')}

interface ${stateClass} {
${fields.map(printField).join('\n')}
}

export const initialState: ${stateClass} = {
${initialFields.map(printFieldInitial).join(',\n')}
};

export function ${pascalToCamel(reducer)}(
  state: ${stateClass} = initialState,
  action: ${reducer}Actions
): ${stateClass} {
  switch (action.type) {
${actions.map(printActionReducerCase).join('\n')}
    default:
      return state;
  }
}`;
  // reducerSource

  const reliefFilePath = path.dirname(file);

  function saveFile(dir: string, suffix: string, source: string): void {
    const dirPath = `${reliefFilePath}/${dir}`;
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }
    fs.writeFileSync(`${dirPath}/${pascalToLowerHyphen(reducer)}${suffix}`, source);
  }

  saveFile('actions', '.actions.ts', actionsSource);
  saveFile('reducers', '.reducer.ts', reducerSource);
}
