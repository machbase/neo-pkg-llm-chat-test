module.exports = function () {
  return {
    name: 'DocLookup',
    description: '문서 검색/조회',
    workflows: ['QueryClassification'],
    toolGroups: ['doc_tools'],
    skipCore: true,
    guards: [],
    hint: '',
    allowTools: [
      'list_available_documents', 'get_full_document_content',
      'get_document_sections', 'extract_code_blocks',
    ],
  };
};
