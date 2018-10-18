"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var glob = require("glob");
glob((process.argv[2] || 'src') + "/**/*.rts", {}, function (er, files) {
    files.forEach(transpileFile);
});
function transpileFile(file) {
    var source = fs.readFileSync(file).toString();
    var sc = ts.createSourceFile('tmp/x.ts', source, ts.ScriptTarget.ES5);
    function addChildWalkData(parent, child) {
        var ast = parent.ast || [];
        if (!Array.isArray(ast[ast.length - 1])) {
            ast.push([]);
        }
        ast[ast.length - 1].push(child.ast);
        return {
            ast: ast,
            reducer: parent.reducer || child.reducer,
            actions: [].concat(parent.actions || [], child.actions || []),
            fields: [].concat(parent.fields || [], child.fields || []),
            imports: [].concat(parent.imports || [], child.imports || []),
            statements: [].concat(parent.statements || [], child.statements || [])
        };
    }
    function getNodeText(node) {
        return source.substring(node.pos, node.end).trim();
    }
    function getName(node) {
        if (node.name) {
            return getIdentifierName(node.name);
        }
        else {
            return '';
        }
    }
    function getIdentifierName(name) {
        if (name.kind === ts.SyntaxKind.StringLiteral) {
            return name.text;
        }
        if (name.kind === ts.SyntaxKind.Identifier) {
            return name.text;
        }
        return '';
    }
    function getPayloadType(decl) {
        if (decl.type) {
            return getNodeText(decl.type);
        }
        else {
            return 'any';
        }
    }
    function pascalToCamel(str) {
        return str.replace(/^(.)/, function (ch) { return ch.toLowerCase(); });
    }
    function pascalToUnderscore(str) {
        return str.replace(/(?:^|\.?)([A-Z])/g, function (x, y) { return '_' + y; }).replace(/^_/, '').toUpperCase();
    }
    function pascalToLowerHyphen(str) {
        return str.replace(/(?:^|\.?)([A-Z])/g, function (x, y) { return '-' + y; }).replace(/^-/, '').toLowerCase();
    }
    function pascalToWords(str) {
        return str.replace(/(?:^|\.?)([A-Z])/g, function (x, y) { return ' ' + y; }).replace(/^ /, '');
    }
    function pascalToLowerWords(str) {
        return pascalToWords(str).toLowerCase();
    }
    function walkReducerMethodDecl(c, decl) {
        var defaultActionType = pascalToUnderscore(c.action);
        var defaultActionTypeText = "'[" + pascalToWords(c.reducer) + "] " + pascalToLowerWords(c.action) + "'";
        var payloadType = getPayloadType(decl);
        if (!decl.body) {
            throw c.action + " does not have a function body";
        }
        var fnBody = decl.body.statements.map(function (st) { return getNodeText(st); }).join('\n');
        var resPrefix = [c.action, payloadType, fnBody];
        var res;
        if (decl.parameters.length === 1) {
            var param = decl.parameters[0];
            var name_1 = getName(param);
            if (param.initializer) {
                res = resPrefix.concat([name_1, getNodeText(param.initializer)]);
            }
            else {
                res = resPrefix.concat([name_1, defaultActionTypeText]);
            }
        }
        else {
            res = resPrefix.concat([defaultActionType, defaultActionTypeText]);
        }
        return __assign({ actions: [res] }, genAST(decl));
    }
    function walkReducerPropertyDecl(decl) {
        var name = getName(decl);
        return __assign({ fields: [[name, getNodeText(decl.type), decl.initializer ? getNodeText(decl.initializer) : '']] }, genAST(decl));
    }
    function walkReducerClassMember(c, node) {
        var res = genAST(node);
        switch (node.kind) {
            case ts.SyntaxKind.PropertyDeclaration:
                return addChildWalkData(res, walkReducerPropertyDecl(node));
            case ts.SyntaxKind.MethodDeclaration:
                var name_2 = getName(node);
                return addChildWalkData(res, walkReducerMethodDecl(__assign({}, c, { action: name_2 }), node));
            default:
                return res;
        }
    }
    function genAST(node) {
        return {
            ast: [ts.SyntaxKind[node.kind], node.pos, node.end]
        };
    }
    function getImportedNames(decl) {
        if (decl.importClause && decl.importClause.name) {
            return [getNodeText(decl.importClause.name)];
        }
        if (decl.importClause && decl.importClause.namedBindings) {
            var node = decl.importClause.namedBindings;
            switch (node.kind) {
                case ts.SyntaxKind.NamespaceImport:
                    return [getNodeText(node.name)];
                case ts.SyntaxKind.NamedImports:
                    return node.elements.map(function (el) { return getNodeText(el.name); });
            }
        }
        return [];
    }
    function walkImport(decl) {
        return __assign({ imports: [[getNodeText(decl), getImportedNames(decl)]] }, genAST(decl));
    }
    function walkSyntaxListItem(node) {
        switch (node.kind) {
            case ts.SyntaxKind.ClassDeclaration:
                var context_1 = {
                    reducer: getName(node)
                };
                return node
                    .members
                    .map(function (member) { return walkReducerClassMember(context_1, member); })
                    .reduce(addChildWalkData, __assign({}, context_1, genAST(node)));
            case ts.SyntaxKind.ImportDeclaration:
                return walkImport(node);
            default:
                return __assign({ statements: [getNodeText(node)] }, genAST(node));
        }
    }
    function walk(node) {
        switch (node.kind) {
            case ts.SyntaxKind.SyntaxList:
                return node
                    .getChildren()
                    .map(walkSyntaxListItem)
                    .reduce(addChildWalkData, genAST(node));
            default:
                var children = void 0;
                try {
                    children = node.getChildren();
                }
                catch (e) {
                    children = [];
                }
                return children.map(walk).reduce(addChildWalkData, genAST(node));
        }
    }
    var _a = walk(sc), reducer = _a.reducer, actions = _a.actions, fields = _a.fields, imports = _a.imports, statements = _a.statements;
    var initialFields = fields.filter(function (field) { return field[2]; });
    var actionImports = imports.filter(function (_a) {
        var importStatement = _a[0], importNames = _a[1];
        return importNames.some(function (name) {
            return actions.some(function (_a) {
                var actionName = _a[0], payloadType = _a[1];
                return payloadType.startsWith(name);
            });
        });
    });
    var stateClass = reducer + "State";
    function printActionType(_a) {
        var actionName = _a[0], payloadType = _a[1], body = _a[2], actionType = _a[3], actionTypeText = _a[4];
        return actionType + ": " + actionTypeText;
    }
    function printAction(_a) {
        var actionName = _a[0], payloadType = _a[1], body = _a[2], actionType = _a[3];
        return "export class " + actionName + "Action implements Action {\n  public type: string = " + reducer + "Types." + actionType + ";\n  constructor(public payload" + (payloadType === 'any' ? '?' : '') + ": " + payloadType + ") {}\n}";
    }
    function printActionReducerCase(_a) {
        var actionName = _a[0], payloadType = _a[1], body = _a[2], actionType = _a[3];
        return "    case " + reducer + "Types." + actionType + ":\n      " + body.split('\n').join('\n  ') + "\n";
    }
    function printField(_a) {
        var name = _a[0], type = _a[1];
        return "  " + name + ": " + type + ";";
    }
    function printFieldInitial(_a) {
        var name = _a[0], type = _a[1], initialValue = _a[2];
        return "  " + name + ": " + initialValue;
    }
    var actionImportStatements = ["import { Action } from '@ngrx/store';"].concat(actionImports.map(function (_a) {
        var statement = _a[0];
        return statement;
    }));
    var actionsSource = actionImportStatements.join('\n') + "\n\nexport const " + reducer + "Types = {\n  " + actions.map(printActionType).join(',\n  ') + "\n}\n\n" + actions.map(printAction).join('\n\n') + "\n\nexport type " + reducer + "Actions =\n  | " + actions.map(function (_a) {
        var actionName = _a[0];
        return actionName + 'Action';
    }).join('\n  | ') + ";";
    // actionsSource
    var reducerSource = imports.map(function (_a) {
        var statement = _a[0];
        return statement;
    }).join('\n') + "\n\n" + statements.join('\n\n') + "\n\ninterface " + stateClass + " {\n" + fields.map(printField).join('\n') + "\n}\n\nexport const initialState: " + stateClass + " = {\n" + initialFields.map(printFieldInitial).join(',\n') + "\n};\n\nexport function " + pascalToCamel(reducer) + "(\n  state: " + stateClass + " = initialState,\n  action: " + reducer + "Actions\n): " + stateClass + " {\n  switch (action.type) {\n" + actions.map(printActionReducerCase).join('\n') + "\n    default:\n      return state;\n  }\n}";
    // reducerSource
    var reliefFilePath = path.dirname(file);
    function saveFile(dir, suffix, source) {
        var dirPath = reliefFilePath + "/" + dir;
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
        }
        fs.writeFileSync(dirPath + "/" + pascalToLowerHyphen(reducer) + suffix, source);
    }
    saveFile('actions', '.actions.ts', actionsSource);
    saveFile('reducers', '.reducer.ts', reducerSource);
}
//# sourceMappingURL=relief.js.map