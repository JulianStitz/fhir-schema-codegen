import {ClassField, NestedTypeSchema, TypeRef, TypeSchema} from "@fscg/typeschema";
import {NameGenerator} from "@fscg/generators/mustache/generator/NameGenerator";
import {EnumViewModel} from "@fscg/generators/mustache/types/EnumViewModel";
import {TypeViewModel} from "@fscg/generators/mustache/types/TypeViewModel";
import {ResolvedTypeViewModel} from "@fscg/generators/mustache/types/ResolvedTypeViewModel";
import {SchemaLoaderFacade} from "@fscg/generators/mustache/generator/SchemaLoaderFacade";
import {ListElementInformationMixinProvider} from "@fscg/generators/mustache/generator/ListElementInformationMixinProvider";
import {PRIMITIVE_TYPES} from "@fscg/generators/mustache/types/PrimitiveType";
import {FieldViewModel} from "@fscg/generators/mustache/types/FieldViewModel";
import {IsPrefixed} from "@fscg/generators/mustache/UtilityTypes";
import {ViewModel} from "@fscg/generators/mustache/types/ViewModel";
import {RootViewModel} from "@fscg/generators/mustache/types/RootViewModel";

export type ViewModelCache = {
    resourcesByUri: Record<string, TypeViewModel>;
    complexTypesByUri: Record<string, TypeViewModel>;
}

export class ViewModelFactory {
    private arrayMixinProvider: ListElementInformationMixinProvider = new ListElementInformationMixinProvider();

    constructor(private readonly loader: SchemaLoaderFacade, private readonly nameGenerator: NameGenerator) {
    }

    public createUtility(): RootViewModel<ViewModel> {
        return this._createForRoot();
    }

    public createComplexType(typeRef: TypeRef, cache: ViewModelCache = {resourcesByUri: {}, complexTypesByUri: {}}): RootViewModel<ResolvedTypeViewModel>{
        const base = this._createForComplexType(typeRef, cache);
        const parents = this._createParentsFor(base.schema, cache);
        const children = this._createChildrenFor(typeRef, cache);
        return this.arrayMixinProvider.apply({
            ...this._createForRoot(),
            ...base,
            parents,
            children,
            inheritedFields: parents.flatMap(p=>p.fields),
            allFields: [...base.fields,...parents.flatMap(p=>p.fields)]
        });
    }
    public createResource(typeRef: TypeRef, cache: ViewModelCache = {resourcesByUri: {}, complexTypesByUri: {}}): RootViewModel<ResolvedTypeViewModel>{
        const base = this._createForResource(typeRef, cache);
        const parents = this._createParentsFor(base.schema, cache);
        const children = this._createChildrenFor(typeRef, cache);
        return this.arrayMixinProvider.apply({
            ...this._createForRoot(),
            ...base,
            parents,
            children,
            inheritedFields: parents.flatMap(p=>p.fields),
            allFields: [...base.fields,...parents.flatMap(p=>p.fields)]
        });
    }

    private _createFor(typeRef: TypeRef, cache: ViewModelCache, nestedIn?: TypeSchema): TypeViewModel{
        if(typeRef.kind === 'complex-type'){
            return this._createForComplexType(typeRef, cache, nestedIn);
        }
        if(typeRef.kind === 'resource'){
            return this._createForResource(typeRef, cache, nestedIn);
        }
        throw new Error(`Unknown type ${typeRef.kind}`);
    }

    private _createForComplexType(typeRef: TypeRef, cache: ViewModelCache, nestedIn?: TypeSchema): TypeViewModel{
        const type = this.loader.getComplexType(typeRef);
        if(!type){
            throw new Error(`ComplexType ${typeRef.name} not found`)
        }
        if(!cache.complexTypesByUri.hasOwnProperty(type.identifier.url)){
            cache.complexTypesByUri[type.identifier.url] = this._createTypeViewModel(type, cache, nestedIn);
        }
        return cache.complexTypesByUri[type.identifier.url];
    }

    private _createForResource(typeRef: TypeRef, cache: ViewModelCache, nestedIn?: TypeSchema): TypeViewModel{
        const type = this.loader.getResource(typeRef);
        if(!type){
            throw new Error(`Resource ${typeRef.name} not found`)
        }
        if(!cache.resourcesByUri.hasOwnProperty(type.identifier.url)){
            cache.resourcesByUri[type.identifier.url] = this._createTypeViewModel(type, cache, nestedIn);
        }
        return cache.resourcesByUri[type.identifier.url];
    }

    private _createChildrenFor(typeRef: TypeRef, cache: ViewModelCache, nestedIn?: TypeSchema): TypeViewModel[] {
        return this.loader.getChildResources(typeRef)
            .map(childRef => this._createFor(childRef, cache, nestedIn));
    }

    private _createParentsFor(base: TypeSchema | NestedTypeSchema, cache: ViewModelCache){
        const parents: TypeViewModel[] = [];
        let parentRef: TypeRef | undefined = base.base;
        while(parentRef){
            parents.push(this._createFor(parentRef, cache, undefined));
            const parent = this.loader.get(parentRef);
            parentRef = parent?.base;
        }
        return parents;
    }

    private _createForNestedType(nested: NestedTypeSchema, cache: ViewModelCache, nestedIn?: TypeSchema): ResolvedTypeViewModel{
        const base = this._createTypeViewModel(nested, cache, nestedIn);
        const parents = this._createParentsFor(nested, cache);
        const children = this._createChildrenFor(nested.identifier, cache, nestedIn);
        return {
            ...base,
            parents,
            children,
            inheritedFields: parents.flatMap(p=>p.fields),
            allFields: [...base.fields,...parents.flatMap(p=>p.fields)]
        }
    }

    private _createTypeViewModel(schema: TypeSchema | NestedTypeSchema, cache: ViewModelCache, nestedIn?: TypeSchema): TypeViewModel{
        const fields = Object.entries(schema.fields ?? {});
        const nestedComplexTypes = this._collectNestedComplex(schema, cache);
        const nestedEnums = this._collectNestedEnums(fields);
        return {
            nestedComplexTypes,
            nestedEnums,
            isNested: !!nestedIn,
            schema: schema,
            name: schema.identifier.name,
            saveName: this.nameGenerator.generateType(schema),
            isResource: this._createIsResource(schema.identifier),
            isComplexType: this._createIsComplexType(schema.identifier),
            fields: fields
                .filter(([_fieldName, fieldSchema])=>!!fieldSchema.type)
                .sort((a,b)=>a[0].localeCompare(b[0]))
                .map(([fieldName, fieldSchema])=>{

                    return {
                        schema: fieldSchema,
                        name: fieldName,
                        saveName: this.nameGenerator.generateField(fieldName),
                        typeName: this.nameGenerator.generateFieldType(fieldSchema),

                        isArray: fieldSchema.array,
                        isRequired: fieldSchema.required,
                        isEnum: !!fieldSchema.enum,
                        isPrimitive: this._createIsPrimitiveType(fieldSchema.type),

                        isSizeConstrained: fieldSchema.min !== undefined || fieldSchema.max !== undefined,
                        min: fieldSchema.min,
                        max: fieldSchema.max,

                        isResource: this._createIsResource(fieldSchema.type),
                        isComplexType: this._createIsComplexType(fieldSchema.type),
                        isPrimitiveType: fieldSchema.type.kind === 'primitive-type',

                        isCode: fieldSchema.type.name === 'code',
                        isIdentifier: fieldSchema.type.name === 'Identifier',
                        isReference: fieldSchema.type.name === 'Reference'
                    };
                }
            )
        }
    }

    private _createIsResource(typeRef: TypeRef): Record<IsPrefixed<string>, boolean> | false {
        if(typeRef.kind !== 'resource'){
            return false;
        }
        return Object.fromEntries(this.loader.getResources().map(resourceRef=>[`is${resourceRef.name.charAt(0).toUpperCase()+resourceRef.name.slice(1)}`, resourceRef.url === typeRef.url])) as Record<IsPrefixed<string>, boolean>;
    }
    private _createIsComplexType(typeRef: TypeRef): Record<IsPrefixed<string>, boolean> | false {
        if(typeRef.kind !== 'complex-type' && typeRef.kind !== 'nested'){
            return false;
        }
        return Object.fromEntries(this.loader.getComplexTypes().map(complexTypeRef=>[`is${complexTypeRef.name.charAt(0).toUpperCase()+complexTypeRef.name.slice(1)}`, complexTypeRef.url === typeRef.url])) as Record<IsPrefixed<string>, boolean>;
    }
    private _createIsPrimitiveType(typeRef: TypeRef): Record<IsPrefixed<string>, boolean> | false {
        if(typeRef.kind !== 'primitive-type'){
            return false;
        }
        return Object.fromEntries(PRIMITIVE_TYPES.map(type=>(['is'+type.charAt(0).toUpperCase()+type.slice(1), typeRef.name === type]))) as FieldViewModel['isPrimitive'];
    }

    private _collectNestedComplex(schema: TypeSchema | NestedTypeSchema, cache: ViewModelCache,): ResolvedTypeViewModel[] {
        const nested: ResolvedTypeViewModel[] = [];
        if('nested' in schema && schema.nested){
            schema.nested.map(nested => this._createForNestedType(nested, cache, schema)).forEach(n=>nested.push(n));
        }
        return nested;
    }
    private _collectNestedEnums(fields:[string, ClassField][]): EnumViewModel[] {
        const nestedEnumValues: Record<string, Set<string>> = {};
        fields.forEach(([fieldName, fieldSchema])=>{if(fieldSchema.enum){
            const name = fieldSchema.binding?.name ?? fieldName;
            nestedEnumValues[name] = nestedEnumValues[name] ?? new Set<string>();
            fieldSchema.enum.forEach(nestedEnumValues[name].add.bind(nestedEnumValues[name]));
        }});
        return Object.entries(nestedEnumValues).map(([name, values])=>({
            name: name,
            saveName: this.nameGenerator.generateEnumType(name),
            values: Array.from(values).map(value=>({
                name: value,
                saveName: this.nameGenerator.generateEnumValue(value)
            }))
        }))
    }

    private _createForRoot(): Pick<RootViewModel<unknown>, 'resources' |'complexTypes'>{
        return this.arrayMixinProvider.apply({
            complexTypes: this.loader.getComplexTypes().map(typeRef=>({
                name: typeRef.name,
                saveName: this.nameGenerator.generateType(typeRef)
            })),
            resources: this.loader.getResources().map(typeRef => ({
                name: typeRef.name,
                saveName: this.nameGenerator.generateType(typeRef)
            }))
        });
    }
}
