import { useState, useEffect, useRef, useCallback } from "react";
import * as monaco from "monaco-editor";

// Definición de la interfaz File
interface File {
  id: number;
  name: string;
  content: string;
  active: boolean;
}

// Interfaz para representar funciones eliminables
interface EliminableFunction {
  name: string;
  reason: string;
  startLine: number;
  endLine: number;
  decorationId?: string;
}

// Componente principal del IDE
const IDE = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [cursorPosition, setCursorPosition] = useState({
    lineNumber: 1,
    column: 1,
  });
  const [indentSize, setIndentSize] = useState(2);
  const [salida, setSalida] = useState<string | null>("No hay salida");
  const [isError, setIsError] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [hasExecuted, setHasExecuted] = useState(false);
  const [eliminableFunctions, setEliminableFunctions] = useState<
    EliminableFunction[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Nuevo estado para controlar el ancho de los paneles
  const [editorWidth, setEditorWidth] = useState(50); // Porcentaje inicial
  const isDraggingRef = useRef(false);

  // Función para procesar la respuesta del servidor y extraer las funciones eliminables
  const processFunctionResponse = (response: string): EliminableFunction[] => {
    const lines = response.split("\n");
    const functions: EliminableFunction[] = [];

    for (const line of lines) {
      if (line.trim() === "") continue;

      // Patrones para detectar los mensajes sobre funciones eliminables
      const neverCalledMatch = line.match(
        /La función (\S+) se puede eliminar ya que nunca es llamada/
      );
      const calledOnceMatch = line.match(
        /La función (\S+) se puede eliminar ya que fue llamada (\d+) veces/
      );

      if (neverCalledMatch) {
        functions.push({
          name: neverCalledMatch[1],
          reason: "nunca es llamada",
          startLine: -1, // Se actualizará después analizando el código
          endLine: -1,
        });
      } else if (calledOnceMatch) {
        functions.push({
          name: calledOnceMatch[1],
          reason: `fue llamada ${calledOnceMatch[2]} veces`,
          startLine: -1,
          endLine: -1,
        });
      }
    }

    return functions;
  };

  // Función para buscar la ubicación de las funciones en el código
  const findFunctionLocations = (
    code: string,
    functions: EliminableFunction[]
  ): EliminableFunction[] => {
    const lines = code.split("\n");
    const updatedFunctions = [...functions];

    for (let i = 0; i < updatedFunctions.length; i++) {
      const funcNameParts = updatedFunctions[i].name.split(".");
      const className = funcNameParts[0];
      const methodName = funcNameParts[1];

      // Expresión regular para encontrar la definición de la función
      const methodPattern = new RegExp(
        `(public|private|protected)\\s+\\w+\\s+${methodName}\\s*\\(`
      );

      // Buscar la línea donde comienza la función
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        if (methodPattern.test(lines[lineNum])) {
          updatedFunctions[i].startLine = lineNum + 1; // +1 porque las líneas de editor empiezan en 1

          // Buscar dónde termina la función (encuentra la llave de cierre correspondiente)
          let openBraces = 0;
          let closeBraces = 0;
          let foundOpeningBrace = false;

          for (let j = lineNum; j < lines.length; j++) {
            if (!foundOpeningBrace && lines[j].includes("{")) {
              foundOpeningBrace = true;
            }

            if (foundOpeningBrace) {
              openBraces += (lines[j].match(/{/g) || []).length;
              closeBraces += (lines[j].match(/}/g) || []).length;

              if (openBraces === closeBraces && openBraces > 0) {
                updatedFunctions[i].endLine = j + 1;
                break;
              }
            }
          }

          break;
        }
      }
    }

    return updatedFunctions;
  };

  //Función para llamar al backend
  const executeCode = async () => {
    const activeFile = files.find((f) => f.active);
    if (!activeFile) return;

    setIsExecuting(true);
    setSalida("Ejecutando...");
    setEliminableFunctions([]); // Limpiar funciones eliminables anteriores

    try {
      const response = await fetch(
        "http://localhost:8080/simplify/getSimplify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: activeFile.name,
            instruction: activeFile.content,
          }),
        }
      );

      const data = await response.json();
      console.log("Respuesta del servidor:", data);

      if (data.responses != null) {
        const concatenatedResponses = data.responses
          .map((response: string) => response)
          .join("\n\n");
          setSalida("Código ejecutado correctamente.");
        setIsError(false);

        // Procesar la respuesta para detectar funciones eliminables
        const functions = processFunctionResponse(concatenatedResponses);
        // Encontrar la ubicación de estas funciones en el código
        const functionsWithLocations = findFunctionLocations(
          activeFile.content,
          functions
        );
        setEliminableFunctions(functionsWithLocations);
      }
      if (data.errors != null) {
        const concatenatedErrors = data.errors
          .map((error: string) => error)
          .join("\n\n");
        setSalida(concatenatedErrors);
        setIsError(true);
        setEliminableFunctions([]); // Limpiar cuando hay errores
      }
      setIsExecuting(false);
      setHasExecuted(true);
    } catch (error) {
      console.error("Error al ejecutar el código:", error);
      setSalida(`Error al ejecutar: ${(error as Error).message}`);
      setIsError(true);
      setIsExecuting(false);
      setHasExecuted(true);
      setEliminableFunctions([]);
    }
  };

  const addNewFile = () => {
    const newId =
      files.length > 0 ? Math.max(...files.map((f) => f.id)) + 1 : 1;
    const newFileName = `file.java`;

    const updatedFiles = files.map((file) => ({
      ...file,
      active: false,
    }));

    setFiles([
      ...updatedFiles,
      {
        id: newId,
        name: newFileName,
        content: "",
        active: true,
      },
    ]);
  };

  const updateFileContent = (id: number, newContent: string) => {
    setFiles(
      files.map((file) =>
        file.id === id ? { ...file, content: newContent } : file
      )
    );
  };

  const activateFile = (id: number): void => {
    setFiles(
      files.map((file) => ({
        ...file,
        active: file.id === id,
      }))
    );
    // Limpiar funciones eliminables al cambiar de archivo
    setEliminableFunctions([]);
  };

  const closeFile = (
    id: number,
    e: React.MouseEvent<HTMLButtonElement>
  ): void => {
    e.stopPropagation();

    const fileToRemove = files.find((f) => f.id === id);
    if (fileToRemove && fileToRemove.active && files.length > 1) {
      const index = files.findIndex((f) => f.id === id);
      const nextActiveIndex = index === 0 ? 1 : index - 1;
      const updatedFiles = files.filter((f) => f.id !== id);
      updatedFiles[nextActiveIndex].active = true;
      setFiles(updatedFiles);
    } else {
      setFiles(files.filter((f) => f.id !== id));
    }
    // Limpiar funciones eliminables al cerrar archivo
    if (fileToRemove && fileToRemove.active) {
      setEliminableFunctions([]);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = event.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const filePromises = Array.from(uploadedFiles).map((file) => {
      return new Promise<File>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = (e.target?.result as string) || "";
          const newId =
            files.length > 0 ? Math.max(...files.map((f) => f.id)) + 1 : 1;
          resolve({
            id: newId + Math.random(), // Asegurarse de que sea único
            name: file.name,
            content: content,
            active: false,
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(filePromises).then((newFiles) => {
      // Desactivar los archivos existentes
      const updatedExistingFiles = files.map((file) => ({
        ...file,
        active: false,
      }));

      // Activar el último archivo nuevo
      if (newFiles.length > 0) {
        newFiles[newFiles.length - 1].active = true;
      }

      setFiles([...updatedExistingFiles, ...newFiles]);
      // Limpiar funciones eliminables al cargar nuevos archivos
      setEliminableFunctions([]);
    });

    // Limpiar el input para permitir cargar el mismo archivo nuevamente
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const clearOutput = () => {
    setSalida("No hay salida");
    setHasExecuted(false);
    setEliminableFunctions([]);
  };

  // Función para eliminar una función del archivo activo
  const removeFunction = (func: EliminableFunction) => {
    setSalida("");
    const activeFile = files.find((f) => f.active);
    if (!activeFile || func.startLine <= 0 || func.endLine <= 0) return;

    // Obtener el contenido del archivo actual
    const content = activeFile.content;
    const lines = content.split("\n");

    // Crear nuevo contenido sin la función eliminada
    const updatedLines = [
      ...lines.slice(0, func.startLine - 1),
      ...lines.slice(func.endLine),
    ];

    // Actualizar el contenido del archivo
    updateFileContent(activeFile.id, updatedLines.join("\n"));

    // Actualizar la lista de funciones eliminables
    setEliminableFunctions((prev) => prev.filter((f) => f.name !== func.name));

    // Añadir mensaje a la salida
    setSalida(
      (prev) =>
        `Función ${func.name} eliminada con éxito.\n\n${
          prev === "No hay salida" ? "" : prev
        }`
    );
  };

  // Nuevas funciones para manejar el redimensionamiento
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
    // Añadir clase para cambiar el cursor durante el drag
    document.body.classList.add('resizing');
  };

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const containerWidth = document.querySelector('.flex.flex-1.overflow-hidden')?.clientWidth || 0;
    if (containerWidth > 0) {
      const newEditorWidth = (e.clientX / containerWidth) * 100;
      // Limitar el rango para evitar paneles demasiado pequeños
      if (newEditorWidth >= 20 && newEditorWidth <= 80) {
        setEditorWidth(newEditorWidth);
      }
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', handleDragEnd);
    // Eliminar la clase del cursor
    document.body.classList.remove('resizing');
  }, [handleDrag]);

  // Limpiar los event listeners cuando el componente se desmonta
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [handleDrag, handleDragEnd]);

  const activeFile = files.find((f) => f.active);

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
              <>
                <div 
                  className="flex-1 overflow-hidden"
                  style={{ width: `${editorWidth}%` }}
                >
                  <EditorPanel
                    file={activeFile}
                    setCursorPosition={setCursorPosition}
                    updateFileContent={updateFileContent}
                    executeCode={executeCode}
                    isExecuting={isExecuting}
                    eliminableFunctions={eliminableFunctions}
                  />
                </div>
                {/* Divisor redimensionable */}
                <div 
                  className="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize flex-shrink-0"
                  onMouseDown={handleDragStart}
                />
                <div 
                  className="overflow-hidden"
                  style={{ width: `${100 - editorWidth}%` }}
                >
                  <ResultsPanel
                    salida={salida}
                    isError={isError}
                    hasExecuted={hasExecuted}
                    clearOutput={clearOutput}
                    eliminableFunctions={eliminableFunctions}
                    removeFunction={removeFunction}
                  />
                </div>
              </>
            ) : (
              <WelcomeScreen
                addNewFile={addNewFile}
                triggerFileUpload={triggerFileUpload}
              />
            )}
          </div>
          <StatusBar
            cursorPosition={cursorPosition}
            indentSize={indentSize}
            authorName="Alejandro Gutiérrez Barrera // José De Jesús Zarate García "
          />
        </div>
      </div>
      {/* Estilos globales para el cursor durante el redimensionamiento */}
      <style jsx global>{`
        body.resizing {
          cursor: col-resize !important;
          user-select: none;
        }
        body.resizing * {
          cursor: col-resize !important;
        }
      `}</style>
      {/* Input oculto para la carga de archivos */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        style={{ display: "none" }}
        multiple
      />
    </div>
  );
};

// Componente de pantalla de bienvenida
const WelcomeScreen = ({
  addNewFile,
  triggerFileUpload,
}: {
  addNewFile: () => void;
  triggerFileUpload: () => void;
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-800 text-gray-300">
      <h1 className="text-3xl font-bold mb-6">Bienvenido al Editor</h1>
      <p className="text-lg mb-8 text-gray-400">
        Crea un nuevo archivo o carga uno existente
      </p>
      <div className="flex space-x-4">
        <button
          onClick={addNewFile}
          className="px-6 py-3 rounded bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white flex items-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Nuevo archivo
        </button>
        <button
          onClick={triggerFileUpload}
          className="px-6 py-3 rounded bg-blue-700 hover:bg-blue-600 border border-blue-600 text-white flex items-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2"
          >
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
  triggerFileUpload,
}: {
  files: File[];
  addNewFile: () => void;
  activateFile: (id: number) => void;
  triggerFileUpload: () => void;
}) => {
  return (
    <div className="w-56 bg-gray-800 text-gray-300 border-r border-gray-700">
      <div className="p-2 font-medium flex justify-between items-center border-b border-gray-700">
        <span>IDE</span>
        <div className="flex">
          <button
            onClick={addNewFile}
            className="p-1 rounded hover:bg-gray-700 mr-1"
            title="Nuevo archivo"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button
            onClick={triggerFileUpload}
            className="p-1 rounded hover:bg-gray-700"
            title="Cargar archivo"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
        </div>
      </div>
      <div className="p-2 hover:bg-gray-700">
        <div className="flex items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Archivos</span>
        </div>
      </div>
      <div className="pl-6">
        {files.map((file) => (
          <div
            key={file.id}
            className={`p-2 cursor-pointer ${
              file.active ? "bg-gray-700" : "hover:bg-gray-700"
            }`}
            onClick={() => activateFile(file.id)}
          >
            <div className="flex items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
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
  closeFile,
}: {
  files: File[];
  activateFile: (id: number) => void;
  closeFile: (id: number, e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
  if (files.length === 0) return null;

  return (
    <div className="flex bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => activateFile(file.id)}
          className={`px-4 py-2 flex items-center cursor-pointer ${
            file.active
              ? "bg-gray-800 text-gray-300"
              : "bg-gray-900 text-gray-500"
          } border-r border-gray-700`}
        >
          <span>{file.name}</span>
          <button
            onClick={(e) => closeFile(file.id, e)}
            className="ml-2 rounded-full hover:bg-opacity-20 hover:bg-gray-500 p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
  eliminableFunctions: EliminableFunction[];
}

const MonacoEditor = ({
  initialContent,
  fileName,
  setCursorPosition,
  onChange,
  eliminableFunctions,
}: MonacoEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );
  const [content, setContent] = useState(initialContent);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    if (editorRef.current && !monacoEditorRef.current) {
      const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
      let language = "plaintext";

      // Mapeo de extensiones de archivos a lenguajes soportados por Monaco
      const languageMap: { [key: string]: string } = {
        java: "java",
        js: "javascript",
        ts: "typescript",
        tsx: "typescript",
        jsx: "javascript",
        html: "html",
        css: "css",
        json: "json",
        md: "markdown",
        py: "python",
        c: "c",
        cpp: "cpp",
        cs: "csharp",
        go: "go",
        php: "php",
        rb: "ruby",
        rs: "rust",
        sql: "sql",
        xml: "xml",
        yaml: "yaml",
        yml: "yaml",
      };

      if (fileExtension && fileExtension in languageMap) {
        language = languageMap[fileExtension];
      }

      monacoEditorRef.current = monaco.editor.create(editorRef.current, {
        value: content,
        language: language,
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
        scrollBeyondLastLine: false,
        wordWrap: "on",
      });

      // Configura el listener para cambios
      monacoEditorRef.current.onDidChangeModelContent(() => {
        const newValue = monacoEditorRef.current?.getValue() || "";
        setContent(newValue);
        onChange(newValue);
      });

      monacoEditorRef.current.onDidChangeCursorPosition((e) => {
        setCursorPosition({
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        });
      });

      // Añadir soporte para hover
      monaco.languages.registerHoverProvider(language, {
        provideHover: function (model, position) {
          const lineContent = model.getLineContent(position.lineNumber);

          // Revisar si la línea actual está dentro de una función eliminable
          for (const func of eliminableFunctions) {
            if (
              position.lineNumber >= func.startLine &&
              position.lineNumber <= func.endLine
            ) {
              return {
                contents: [
                  { value: `**Función eliminable**` },
                  {
                    value: `La función ${func.name} se puede eliminar ya que ${func.reason}.`,
                  },
                ],
              };
            }
          }

          return null;
        },
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

  // Manejar las decoraciones para funciones eliminables
  useEffect(() => {
    if (!monacoEditorRef.current) return;

    // Limpiar decoraciones existentes
    if (decorationsRef.current.length > 0) {
      monacoEditorRef.current.deltaDecorations(decorationsRef.current, []);
      decorationsRef.current = [];
    }

    // Si no hay funciones eliminables, no hacemos nada más
    if (eliminableFunctions.length === 0) return;

    // Crear las nuevas decoraciones
    const decorations = eliminableFunctions
      .filter((func) => func.startLine > 0 && func.endLine > 0) // Solo las que tienen líneas válidas
      .map((func) => {
        return {
          range: new monaco.Range(func.startLine, 1, func.endLine, 1),
          options: {
            isWholeLine: true,
            className: "eliminable-function",
            glyphMarginClassName: "eliminable-function-glyph",
            overviewRuler: {
              color: "#ff0000",
              position: monaco.editor.OverviewRulerLane.Left,
            },
            minimap: {
              color: "#ff0000",
              position: monaco.editor.MinimapPosition.Inline,
            },
            inlineClassName: "eliminable-function-inline",
            linesDecorationsClassName: "eliminable-function-line-decoration",
            marginClassName: "eliminable-function-margin",
            after: {
              content: "",
              inlineClassName: "eliminable-comment",
            },
          },
        };
      });

    // Aplicar las decoraciones
    if (decorations.length > 0) {
      decorationsRef.current = monacoEditorRef.current.deltaDecorations(
        [],
        decorations
      );

      // Añadir marcadores (similar a errores/advertencias)
      const model = monacoEditorRef.current.getModel();
      if (model) {
        monaco.editor.setModelMarkers(
          model,
          "eliminableFunctions",
          eliminableFunctions
            .filter((func) => func.startLine > 0)
            .map((func) => ({
              startLineNumber: func.startLine,
              startColumn: 1,
              endLineNumber: func.startLine,
              endColumn: model.getLineContent(func.startLine).length + 1,
              message: `La función ${func.name} se puede eliminar ya que ${func.reason}.`,
              severity: monaco.MarkerSeverity.Warning,
            }))
        );
      }
    }
  }, [eliminableFunctions]);

  return (
    <>
      <style>{`
        .eliminable-function-inline {
          text-decoration: line-through;
          opacity: 0.7;
        }
        .eliminable-function {
          background-color: rgba(255, 0, 0, 0.1);
        }
        .eliminable-function-line-decoration {
          background-color: rgba(255, 0, 0, 0.7);
          width: 5px !important;
          margin-left: 3px;
        }
        .eliminable-function-margin {
          background-color: rgba(255, 0, 0, 0.2);
        }
        .eliminable-comment {
          color: #ff6b6b;
          font-style: italic;
        }
      `}</style>
      <div ref={editorRef} className="w-full h-full" />
    </>
  );
};

// Componente para el panel del editor
interface EditorPanelProps {
  file: File;
  setCursorPosition: (position: { lineNumber: number; column: number }) => void;
  updateFileContent: (id: number, content: string) => void;
  executeCode: () => void;
  isExecuting: boolean;
  eliminableFunctions: EliminableFunction[];
}

const EditorPanel = ({
  file,
  setCursorPosition,
  updateFileContent,
  executeCode,
  isExecuting,
  eliminableFunctions,
}: EditorPanelProps) => {
  const handleEditorChange = useCallback(
    (value: string) => {
      updateFileContent(file.id, value);
    },
    [file.id, updateFileContent]
  );

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex-1 bg-gray-800 overflow-hidden">
        <MonacoEditor
          initialContent={file.content}
          fileName={file.name}
          setCursorPosition={setCursorPosition}
          onChange={handleEditorChange}
          eliminableFunctions={eliminableFunctions}
        />
      </div>
      <div className="flex justify-between items-center p-2 bg-gray-800 text-gray-300 border-t border-gray-700">
        <div className="flex space-x-2">
          <button
            onClick={executeCode}
            disabled={isExecuting}
            className={`cursor-pointer px-4 py-1 rounded ${
              isExecuting ? "bg-gray-600" : "bg-green-700 hover:bg-green-600"
            } text-white focus:outline-none focus:ring-2 focus:ring-green-500 flex items-center`}
          >
            {isExecuting ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Ejecutando...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-2"
                >
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
  eliminableFunctions: EliminableFunction[];
  removeFunction: (func: EliminableFunction) => void;
}

const ResultsPanel = ({
  salida,
  isError,
  hasExecuted,
  clearOutput,
  eliminableFunctions,
  removeFunction,
}: ResultsPanelProps) => {
  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700 overflow-hidden">
      <div className="flex justify-between items-center p-2 bg-gray-800 text-gray-300 border-b border-gray-700">
        <div className="flex items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2"
          >
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          <span>Resultados</span>
        </div>
        {hasExecuted && (
          <button
            onClick={clearOutput}
            title="Limpiar salida"
          >
            <div
              className="flex text-sm items-center justify-center bg-gray-600 hover:bg-gray-500 text-white p-1 rounded cursor-pointer"
            >
              Clear
            </div>
          </button>
        )}
      </div>
      <div
        className={`flex-1 p-4 overflow-auto ${
          isError ? "text-red-400" : "text-green-300"
        }`}
      >
        <pre className="whitespace-pre-wrap font-mono text-sm">{salida}</pre>
      </div>
      {eliminableFunctions.length > 0 && (
        <div className="p-4 bg-gray-900 border-t border-gray-700">
          <h3 className="text-yellow-400 font-semibold mb-2">
            Funciones Eliminables Detectadas:
          </h3>
          <ul className="text-sm">
            {eliminableFunctions.map((func, index) => (
              <li
                key={index}
                className="mb-2 text-gray-300 flex justify-between items-center"
              >
                <div>
                  <span className="text-yellow-400 font-mono">{func.name}</span>
                  : {func.reason}
                  <span className="text-gray-500 ml-2">
                    (líneas {func.startLine}-{func.endLine})
                  </span>
                </div>
                <button
                  onClick={() => removeFunction(func)}
                  className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs cursor-pointer"
                  title={`Eliminar función ${func.name}`}
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
    <div className="flex justify-between items-center px-4 py-1 bg-gray-700 text-gray-300 text-xs">
      <div className="flex items-center">
        <span>
          Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
        </span>
        <span className="mx-2">|</span>
        <span>Espacios: {indentSize}</span>
      </div>
      <div>{authorName}</div>
    </div>
  );
};

export default IDE;
