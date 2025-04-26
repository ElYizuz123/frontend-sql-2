import { useState, useEffect, useRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';

// Definición de la interfaz File
interface File {
  id: number;
  name: string;
  content: string;
  active: boolean;
}

// Componente principal del IDE
const IDE = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [cursorPosition, setCursorPosition] = useState({ lineNumber: 1, column: 1 });
  const [indentSize, setIndentSize] = useState(2);
  const [salida, setSalida] = useState<string | null>("No hay salida");
  const [isError, setIsError] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [hasExecuted, setHasExecuted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  //AQUIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
  //ESTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
  //LAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
  //FUNCIOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOON
  //DEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE
  //LAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
  //APIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
  const executeCode = async () => {
    const activeFile = files.find(f => f.active);
    if (!activeFile) return;

    setIsExecuting(true);
    setSalida("Ejecutando...");

    try {
      setTimeout(() => {
        setSalida(`Archivo "${activeFile.name}" ejecutado con éxito.\n\nContenido:\n${activeFile.content}`);
        setIsError(false);
        setIsExecuting(false);
        setHasExecuted(true);
      }, 1000);

      /*
      const response = await fetch('http://localhost:8080/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: activeFile.name,
          content: activeFile.content
        })
      });

      const data = await response.json();
      setSalida(data.output);
      setIsError(data.error);
      setIsExecuting(false);
      setHasExecuted(true);
      */
    } catch (error) {
      console.error('Error al ejecutar el código:', error);
      setSalida(`Error al ejecutar: ${(error as Error).message}`);
      setIsError(true);
      setIsExecuting(false);
      setHasExecuted(true);
    }
  };

  const addNewFile = () => {
    const newId = files.length > 0 ? Math.max(...files.map(f => f.id)) + 1 : 1;
    const newFileName = `file.java`;
    
    const updatedFiles = files.map(file => ({
      ...file,
      active: false
    }));
    
    setFiles([
      ...updatedFiles,
      { 
        id: newId, 
        name: newFileName, 
        content: '', 
        active: true 
      }
    ]);
  };

  const updateFileContent = (id: number, newContent: string) => {
    setFiles(files.map(file => 
      file.id === id ? { ...file, content: newContent } : file
    ));
  };

  const activateFile = (id: number): void => {
    setFiles(files.map(file => ({
      ...file,
      active: file.id === id
    })));
  };

  const closeFile = (id: number, e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    
    const fileToRemove = files.find(f => f.id === id);
    if (fileToRemove && fileToRemove.active && files.length > 1) {
      const index = files.findIndex(f => f.id === id);
      const nextActiveIndex = index === 0 ? 1 : index - 1;
      const updatedFiles = files.filter(f => f.id !== id);
      updatedFiles[nextActiveIndex].active = true;
      setFiles(updatedFiles);
    } else {
      setFiles(files.filter(f => f.id !== id));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = event.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const filePromises = Array.from(uploadedFiles).map(file => {
      return new Promise<File>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string || '';
          const newId = files.length > 0 ? Math.max(...files.map(f => f.id)) + 1 : 1;
          resolve({
            id: newId + Math.random(), // Asegurarse de que sea único
            name: file.name,
            content: content,
            active: false
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(filePromises).then(newFiles => {
      // Desactivar los archivos existentes
      const updatedExistingFiles = files.map(file => ({
        ...file,
        active: false
      }));
      
      // Activar el último archivo nuevo
      if (newFiles.length > 0) {
        newFiles[newFiles.length - 1].active = true;
      }
      
      setFiles([...updatedExistingFiles, ...newFiles]);
    });
    
    // Limpiar el input para permitir cargar el mismo archivo nuevamente
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const clearOutput = () => {
    setSalida("No hay salida");
    setHasExecuted(false);
  };

  const activeFile = files.find(f => f.active);

  return (
    <div className="flex flex-col h-screen bg-gray-900 font-mono">
      <div className="flex flex-1 overflow-hidden">
        <SideBar 
          files={files} 
          addNewFile={addNewFile} 
          activateFile={activateFile}
          triggerFileUpload={triggerFileUpload}
        />
        <div className="flex flex-col flex-1 overflow-hidden">
          <EditorTabs 
            files={files} 
            activateFile={activateFile} 
            closeFile={closeFile}
          />
          <div className="flex flex-1 overflow-hidden">
            {activeFile ? (
              <EditorPanel 
                file={activeFile}
                setCursorPosition={setCursorPosition}
                updateFileContent={updateFileContent}
                executeCode={executeCode}
                isExecuting={isExecuting}
              />
            ) : (
              <WelcomeScreen 
                addNewFile={addNewFile} 
                triggerFileUpload={triggerFileUpload}
              />
            )}
            <ResultsPanel 
              salida={salida} 
              isError={isError} 
              hasExecuted={hasExecuted}
              clearOutput={clearOutput}
            />
          </div>
          <StatusBar 
            cursorPosition={cursorPosition}
            indentSize={indentSize}
            authorName="Alejandro Gutiérrez Barrera // José De Jesús Zarate García // Cristiano Ronaldo Dos Santos Aveiro // Lionel Messi"
          />
        </div>
      </div>
      {/* Input oculto para la carga de archivos */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        style={{ display: 'none' }} 
        multiple 
      />
    </div>
  );
};

// Componente de pantalla de bienvenida
const WelcomeScreen = ({ 
  addNewFile, 
  triggerFileUpload 
}: { 
  addNewFile: () => void;
  triggerFileUpload: () => void;
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-800 text-gray-300">
      <h1 className="text-3xl font-bold mb-6">Bienvenido al Editor Más Mamalón del Mundo</h1>
      <p className="text-lg mb-8 text-gray-400">Crea un nuevo archivo o carga uno existente</p>
      <div className="flex space-x-4">
        <button 
          onClick={addNewFile}
          className="px-6 py-3 rounded bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white flex items-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Nuevo archivo
        </button>
        <button 
          onClick={triggerFileUpload}
          className="px-6 py-3 rounded bg-blue-700 hover:bg-blue-600 border border-blue-600 text-white flex items-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          Cargar archivo
        </button>
      </div>
    </div>
  );
};

// Componente para la barra lateral
const SideBar = ({ 
  files, 
  addNewFile, 
  activateFile,
  triggerFileUpload
}: { 
  files: File[]; 
  addNewFile: () => void; 
  activateFile: (id: number) => void;
  triggerFileUpload: () => void;
}) => {
  return (
    <div className="w-56 bg-gray-800 text-gray-300 border-r border-gray-700">
      <div className="p-2 font-medium flex justify-between items-center border-b border-gray-700">
        <span>IDE Mamalon</span>
        <div className="flex">
          <button 
            onClick={addNewFile}
            className="p-1 rounded hover:bg-gray-700 mr-1"
            title="Nuevo archivo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button 
            onClick={triggerFileUpload}
            className="p-1 rounded hover:bg-gray-700"
            title="Cargar archivo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
        </div>
      </div>
      <div className="p-2 hover:bg-gray-700">
        <div className="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Archivos</span>
        </div>
      </div>
      <div className="pl-6">
        {files.map(file => (
          <div 
            key={file.id}
            className={`p-2 cursor-pointer ${file.active ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
            onClick={() => activateFile(file.id)}
          >
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span className="text-sm truncate">{file.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Componente para las pestañas del editor
const EditorTabs = ({ 
  files, 
  activateFile, 
  closeFile 
}: { 
  files: File[]; 
  activateFile: (id: number) => void; 
  closeFile: (id: number, e: React.MouseEvent<HTMLButtonElement>) => void 
}) => {
  if (files.length === 0) return null;
  
  return (
    <div className="flex bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {files.map(file => (
        <div 
          key={file.id}
          onClick={() => activateFile(file.id)}
          className={`px-4 py-2 flex items-center cursor-pointer ${file.active ? 
            'bg-gray-800 text-gray-300' : 'bg-gray-900 text-gray-500'
          } border-r border-gray-700`}
        >
          <span>{file.name}</span>
          <button 
            onClick={(e) => closeFile(file.id, e)} 
            className="ml-2 rounded-full hover:bg-opacity-20 hover:bg-gray-500 p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

// Componente para el editor Monaco
interface MonacoEditorProps {
  initialContent: string;
  fileName: string;
  setCursorPosition: (position: { lineNumber: number; column: number }) => void;
  onChange: (value: string) => void;
}

const MonacoEditor = ({ initialContent, fileName, setCursorPosition, onChange }: MonacoEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    if (editorRef.current && !monacoEditorRef.current) {
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
      let language = 'plaintext';
      
      // Mapeo de extensiones de archivos a lenguajes soportados por Monaco
      const languageMap: {[key: string]: string} = {
        'java': 'java',
        'js': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'jsx': 'javascript',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'c': 'c',
        'cpp': 'cpp',
        'cs': 'csharp',
        'go': 'go',
        'php': 'php',
        'rb': 'ruby',
        'rs': 'rust',
        'sql': 'sql',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml'
      };
      
      if (fileExtension && fileExtension in languageMap) {
        language = languageMap[fileExtension];
      }

      monacoEditorRef.current = monaco.editor.create(editorRef.current, {
        value: content,
        language: language,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
        scrollBeyondLastLine: false,
        wordWrap: 'on',
      });

      // Configura el listener para cambios
      monacoEditorRef.current.onDidChangeModelContent(() => {
        const newValue = monacoEditorRef.current?.getValue() || '';
        setContent(newValue);
        onChange(newValue);
      });

      monacoEditorRef.current.onDidChangeCursorPosition(e => {
        setCursorPosition({
          lineNumber: e.position.lineNumber,
          column: e.position.column
        });
      });
    }

    return () => {
      monacoEditorRef.current?.dispose();
      monacoEditorRef.current = null;
    };
  }, [fileName]); // Solo dependemos de fileName

  // Actualización externa del contenido
  useEffect(() => {
    if (monacoEditorRef.current && initialContent !== content) {
      monacoEditorRef.current.setValue(initialContent);
      setContent(initialContent);
    }
  }, [initialContent]);

  return <div ref={editorRef} className="w-full h-full" />;
};

// Componente para el panel del editor
interface EditorPanelProps {
  file: File;
  setCursorPosition: (position: { lineNumber: number; column: number }) => void;
  updateFileContent: (id: number, content: string) => void;
  executeCode: () => void;
  isExecuting: boolean;
}

const EditorPanel = ({ 
  file, 
  setCursorPosition, 
  updateFileContent,
  executeCode,
  isExecuting
}: EditorPanelProps) => {
  const handleEditorChange = useCallback((value: string) => {
    updateFileContent(file.id, value);
  }, [file.id, updateFileContent]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 bg-gray-800">
        <MonacoEditor 
          initialContent={file.content}
          fileName={file.name}
          setCursorPosition={setCursorPosition}
          onChange={handleEditorChange}
        />
      </div>
      <div className="flex justify-between items-center p-2 bg-gray-800 text-gray-300 border-t border-gray-700">
        <div className="flex space-x-2">
          <button 
            onClick={executeCode}
            disabled={isExecuting}
            className={`cursor-pointer px-4 py-1 rounded ${isExecuting ? 'bg-gray-600' : 'bg-green-700 hover:bg-green-600'} text-white focus:outline-none focus:ring-2 focus:ring-green-500 flex items-center`}
          >
            {isExecuting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Ejecutando...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Ejecutar
              </>
            )}
          </button>
        </div>
        <div className="text-sm text-gray-400">
          {file.name} - {(file.content.length / 1024).toFixed(2)} KB
        </div>
      </div>
    </div>
  );
};

// Componente para el panel de resultados
interface ResultsPanelProps {
  salida: string | null;
  isError: boolean;
  hasExecuted: boolean;
  clearOutput: () => void;
}

const ResultsPanel = ({ salida, isError, hasExecuted, clearOutput }: ResultsPanelProps) => {
  return (
    <div className="w-1/3 flex flex-col h-full border-l border-gray-700 overflow-hidden">
      {/* Sección de Salida */}
      <div className="flex-1 bg-gray-800 flex flex-col overflow-hidden">
        <div className="p-2 font-medium text-gray-300 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
          <span>Salida</span>
          <div className="flex items-center">
            {hasExecuted && (
              <div className={`px-2 py-1 rounded text-xs mr-2 ${isError ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
                {isError ? 'Error' : 'Éxito'}
              </div>
            )}
            <button
              onClick={clearOutput}
              className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300"
              title="Limpiar salida"
            >
              Clear
            </button>
          </div>
        </div>
        <div className={`p-4 flex-1 overflow-auto font-mono text-sm bg-gray-900 ${isError && hasExecuted ? 'text-red-400' : hasExecuted ? 'text-green-400' : 'text-gray-400'}`}>
          <pre className="whitespace-pre-wrap break-words">
            {salida || "No hay salida disponible"}
          </pre>
        </div>
      </div>
    </div>
  );
};

// Componente para la barra de estado
interface StatusBarProps {
  cursorPosition: { lineNumber: number; column: number };
  indentSize: number;
  authorName: string;
}

const StatusBar = ({ 
  cursorPosition, 
  indentSize, 
  authorName,
}: StatusBarProps) => {
  return (
    <div className="flex justify-between items-center px-4 py-1 text-sm bg-gray-700 text-white">
      <div className="flex items-center space-x-4">
        <span>{authorName}</span>
      </div>
      <div className="flex items-center space-x-4">
        <span>Línea {cursorPosition.lineNumber}, Columna {cursorPosition.column}</span>
        <span>Espacios: {indentSize}</span>
      </div>
    </div>
  );
};

export default IDE;