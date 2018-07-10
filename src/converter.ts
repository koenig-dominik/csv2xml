import * as csvParser from 'csv-parse';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as util from 'util';

const readFile = util.promisify(fs.readFile);
const parseXml = util.promisify(xml2js.parseString);

const templateAttributeIdentifier = 'csv2xmlRepeat';
const containsTemplateExpressionRegex = /\${.*}/;

interface ReplaceXmlLocation {
    value: string,
	parent: object,
    index: number | string,
	superParent: object,
	superIndex: number | string
}

export default class Converter {

    private xmlRepeatTemplate;
    private xmlRepeatEntryPoint;
    private xmlTemplate;
    private xmlBuilder = new xml2js.Builder();

    constructor(private csvInputPath: string, private outputPath: string, private xmlTemplatePath: string, private delimiter: string) {}

    public async init() {
        try {
            const xmlTemplateCode = await readFile(this.xmlTemplatePath);
            this.xmlTemplate = await parseXml(xmlTemplateCode);

            const [xmlRepeatNode, xmlRepeatNodeEntry] = this.getXMLRepeatNodeAndEntry(this.xmlTemplate);
            this.xmlRepeatTemplate = JSON.parse(JSON.stringify(xmlRepeatNode));

            (xmlRepeatNodeEntry as any[]).length = 0; // This clears the array
            this.xmlRepeatEntryPoint = xmlRepeatNodeEntry;

        } catch(error) {
            if(error instanceof Error) {
                error.message = 'Could not initialize converter: ' + error.message;
            }
            throw error;
        }
    }

    private getXMLRepeatNodeAndEntry(xml): [Object, Object] | null {
        const rootNode = xml[Object.keys(xml)[0]];

        const getXMLRepeatNodeRecursive = (nodeList): [Object, Object] | null => {
            for(const node of nodeList) {
                for(let [nodeName, childNodeList] of Object.entries(node)) {
                    if(nodeName === '$') {
                        if(childNodeList[templateAttributeIdentifier] !== undefined) {
                            return [node, nodeList];
                        }
                        continue;
                    }

                    if(!(childNodeList instanceof Array)) {
                        continue;
                    }

                    const result = getXMLRepeatNodeRecursive(childNodeList);
                    if (result !== null) {
                        return result;
                    }
                }
            }

            return null;
        };

        for(const childNode of Object.values(rootNode)) {
            const result = getXMLRepeatNodeRecursive(childNode);
            if(result !== null) {
                delete result[0]['$'][templateAttributeIdentifier];
                return result;
            }
        }

        return null;
    }

    private static getTemplateReplaceLocations(template: object): ReplaceXmlLocation[] {
        let replaceLocations = [];

        const getTemplateReplaceLocationsRecurse = (node: object | string | string[] | object[], parent: object, index: number | string, superParent: object, superIndex: number | string) => {
            if(typeof node === 'string') { // The node is a direct value
                if(node.match(containsTemplateExpressionRegex) !== null) { // Check if the value contains ${}
                    replaceLocations.push({
                        value: node,
                        index: index,
                        parent: parent,
						superParent: superParent,
						superIndex: superIndex
                    });
                }
            } else if(node instanceof Array) { // The node is not a value and can have children
                for(let i = 0; i < node.length; i++) {
                    getTemplateReplaceLocationsRecurse(node[i], node, i, parent, index);
                }
            } else { // The node must be an object
                for(const [key, child] of Object.entries(node)) {
                    getTemplateReplaceLocationsRecurse(child, node, key, parent, index);
                }
            }
        };

        getTemplateReplaceLocationsRecurse(template, null, null, null, null);

        return replaceLocations;
    }

    public async run() {
        let csv = await this.getCsvData();
        let records = Converter.getRecordMap(csv);

        for(const record of records) {
            this.xmlRepeatEntryPoint.push(this.getEvaluatedXmlNode(record));
        }

        let result = this.xmlBuilder.buildObject(this.xmlTemplate);

        fs.writeFileSync(this.outputPath, result);
    }

    private getEvaluatedXmlNode(row: {[key: string]: string}): object { // The variable row is available inside the eval
		let xmlRepeatObject = JSON.parse(JSON.stringify(this.xmlRepeatTemplate));
		let xmlReplaceLocations = Converter.getTemplateReplaceLocations(xmlRepeatObject);
	
        //This function is available inside the eval
        let deleteSubNode = false;
        let deletedIndices = new Map<object, number[]>();
        const condition = function(value) {
            if(!value) {
                deleteSubNode = true;
            }
			
			return '';
        };
        for(let replaceLocation of xmlReplaceLocations) {
            try {
                replaceLocation.parent[replaceLocation.index] = eval('`' + replaceLocation.value + '`');
                if (deleteSubNode) {					
					let deleteParent: object;
					let deleteIndex: string | number;
					if(replaceLocation.index === '_') {
						deleteParent = replaceLocation.superParent;
						deleteIndex = replaceLocation.superIndex;
					} else {
						deleteParent = replaceLocation.parent;
						deleteIndex = replaceLocation.index;
					}
					
                    if (deleteParent instanceof Array) {

                        let adjustedDeleteIndex = deleteIndex as number;
                        if(deletedIndices.has(deleteParent)) {
                            for(let deletedIndex of deletedIndices.get(deleteParent)) {
                                if(deleteIndex > deletedIndex) {
                                    adjustedDeleteIndex--;
                                }
                            }
                        } else {
                            deletedIndices.set(deleteParent, []);
                        }
                        deleteParent.splice(adjustedDeleteIndex, 1);

                        deletedIndices.get(deleteParent).push(deleteIndex as number);
					} else {
						delete deleteParent[deleteIndex];
                    }
                    deleteSubNode = false;
                }
            } catch(error) {
                throw new Error('There was an error in your xml template javascript evaluation: ' + error.message + '\r\n at ' + JSON.stringify(replaceLocation.parent[replaceLocation.index]));
            }
        }

        return xmlRepeatObject;
    }

    private static getRecordMap(data: string[][]): {[key: string]: string}[] {
        let records: {}[] = [];

        let header: string[];
        for(let row of data) {
            if(header === undefined) {
                header = row;
                continue;
            }

            const record = new Map<string, string>();
            for(let i = 0; i < header.length; i++) {
                record[header[i]] = row[i];
            }

            records.push(record);
        }

        return records;
    }

    private getCsvData(): Promise<string[][]> {
        return new Promise((resolve, reject) => {
            fs.createReadStream(this.csvInputPath).pipe(csvParser({delimiter: this.delimiter}, (err, data) => {
                if(err) {
                    reject(err);
                }

                resolve(data);
            }));
        });
    }

}