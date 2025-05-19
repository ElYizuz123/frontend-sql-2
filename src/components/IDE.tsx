import { useState, useEffect, useRef, useCallback } from "react";
import * as monaco from "monaco-editor";

// Definición de la interfaz File
interface File {
  id: number;
  name: string;
  content: string;
  active: boolean;
}

// Interfaz para representar elementos eliminables (funciones y variables)
interface EliminableItem {
  name: string;
  reason: string;
  startLine: number;
  endLine: number;
  decorationId?: string;
  isOnce: boolean;
  isReturned: boolean; // Nueva propiedad
  type: "function" | "variable";
  value?: string; // Para variables, almacenar el valor asignado
  className?: string; // Para guardar la clase a la que pertenece
  methodName?: string; // Para guardar el método al que pertenece
  fullName?: string; // Para guardar el nombre completo (incluyendo clase y método)
}
// Tipo para las pestañas del panel de resultados
type ResultsTab = "methods" | "variables";

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
  const [eliminableItems, setEliminableItems] = useState<EliminableItem[]>([]);
  const [activeResultsTab, setActiveResultsTab] =
    useState<ResultsTab>("methods");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Estado para controlar el ancho de los paneles
  const [editorWidth, setEditorWidth] = useState(50); // Porcentaje inicial
  const isDraggingRef = useRef(false);

  // Función para procesar la respuesta del servidor y extraer los elementos eliminables
  // Función para procesar la respuesta del servidor y extraer los elementos eliminables
  // Función corregida para procesar la respuesta del servidor y extraer los elementos eliminables
  const processItemResponse = (response: string): EliminableItem[] => {
    const lines = response.split("\n");
    const items: EliminableItem[] = [];

    for (const line of lines) {
      if (line.trim() === "") continue;

      // Patrones para detectar los mensajes sobre funciones eliminables
      const neverCalledMatch = line.match(
        /La función (\S+) se puede eliminar ya que nunca es llamada/
      );
      const calledOnceMatch = line.match(
        /La función (\S+) se puede eliminar ya que fue llamada (\d+) veces/
      );

      // Patrón general para variables eliminables o reducibles
      const variablePattern =
        /La variable ([A-Za-z0-9_.]+) es (reducible|eliminable) ya que tiene asignada directamente un valor constante/;
      const variableMatch = line.match(variablePattern);

      if (neverCalledMatch) {
        items.push({
          name: neverCalledMatch[1],
          reason: "nunca es llamada",
          startLine: -1,
          endLine: -1,
          isOnce: false,
          isReturned: false, // Nueva propiedad
          type: "function",
          fullName: neverCalledMatch[1],
        });
      } else if (calledOnceMatch) {
        items.push({
          name: calledOnceMatch[1],
          reason: `fue llamada ${calledOnceMatch[2]} veces`,
          startLine: -1,
          endLine: -1,
          isOnce: true,
          isReturned: false, // Nueva propiedad
          type: "function",
          fullName: calledOnceMatch[1],
        });
      } else if (variableMatch) {
        // Extraer el nombre completo de la variable
        const fullVariableName = variableMatch[1];
        const parts = fullVariableName.split(".");

        // Contar la cantidad de puntos para determinar el tipo
        if (parts.length === 3) {
          // Tres componentes: clase.método.variable -> Es una VARIABLE
          const className = parts[0];
          const methodName = parts[1];
          const varName = parts[2];

          items.push({
            name: varName,
            reason: "tiene asignada directamente un valor constante",
            startLine: -1,
            endLine: -1,
            isOnce: false,
            isReturned: false, // Nueva propiedad
            type: "variable", // Es variable al tener 3 componentes
            className: className,
            methodName: methodName,
            fullName: fullVariableName,
          });
        } else if (parts.length === 2) {
          // Dos componentes: clase.método -> Es un MÉTODO
          const className = parts[0];
          const methodName = parts[1];

          items.push({
            name: methodName,
            reason: "retorna una constante",
            startLine: -1,
            endLine: -1,
            isOnce: false,
            isReturned: true, // Nueva propiedad - TRUE para métodos que retornan constante
            type: "function", // Es función al tener 2 componentes
            className: className,
            fullName: fullVariableName,
          });
        }
      }
    }

    return items;
  };

  // Función mejorada para buscar la ubicación de los elementos en el código
  const findItemLocations = (
    code: string,
    items: EliminableItem[]
  ): EliminableItem[] => {
    const lines = code.split("\n");
    const updatedItems = [...items];

    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];

      if (item.type === "variable" && item.className && item.methodName) {
        // Primero buscar la clase
        let inClass = false;
        let inMethod = false;
        let classFound = false;
        let methodFound = false;
        let openBraces = 0;
        let methodStartLine = -1;

        // Patrones para encontrar la declaración de la clase y método
        const classPattern = new RegExp(`class\\s+${item.className}\\b`);
        const methodPattern = new RegExp(
          `\\b(public|private|protected|)\\s*(static\\s+)?(\\w+\\s+)?${item.methodName}\\s*\\(`
        );

        // Recorrer todas las líneas para encontrar la clase y el método correcto
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const currentLine = lines[lineNum];

          // Buscar la clase
          if (!classFound && classPattern.test(currentLine)) {
            classFound = true;
            inClass = true;
            continue;
          }

          // Contar llaves para saber cuando estamos dentro/fuera de la clase
          if (classFound) {
            const openCurly = (currentLine.match(/{/g) || []).length;
            const closeCurly = (currentLine.match(/}/g) || []).length;

            if (inClass) {
              // Si estamos en la clase, buscamos el método específico
              if (!methodFound && methodPattern.test(currentLine)) {
                methodFound = true;
                inMethod = true;
                methodStartLine = lineNum;
                openBraces = openCurly - closeCurly; // Inicializar contador de llaves para el método

                // Si el método se declara y abre en la misma línea
                if (currentLine.includes("{")) {
                  openBraces = 1;
                }
                continue;
              }

              // Si ya encontramos el método, buscamos la variable dentro del método
              if (inMethod) {
                openBraces += openCurly;
                openBraces -= closeCurly;

                // Patrones para buscar la variable dentro del método
                const varDeclarationPattern = new RegExp(
                  `\\b(int|double|float|long|String|boolean|char|var|final)\\s+${item.name}\\s*=\\s*([^;]+);`
                );
                const assignmentPattern = new RegExp(
                  `\\b${item.name}\\s*=\\s*([^;]+);`
                );

                const varMatch = varDeclarationPattern.exec(currentLine);
                const assignMatch = assignmentPattern.exec(currentLine);

                if (varMatch) {
                  updatedItems[i].startLine = lineNum + 1;
                  updatedItems[i].endLine = lineNum + 1;
                  updatedItems[i].value = varMatch[2].trim();
                  break;
                } else if (assignMatch) {
                  updatedItems[i].startLine = lineNum + 1;
                  updatedItems[i].endLine = lineNum + 1;
                  updatedItems[i].value = assignMatch[1].trim();
                  break;
                }

                // Si llegamos al final del método sin encontrar la variable, salir
                if (openBraces === 0) {
                  inMethod = false;
                  methodFound = false;
                }
              }
            }
          }
        }
      } else if (item.type === "function") {
        // Manejo de Métodos
        let className = "";
        let methodName = "";

        if (item.fullName) {
          const parts = item.fullName.split(".");
          if (parts.length === 2) {
            className = parts[0];
            methodName = parts[1];
          } else {
            methodName = item.name;
          }
        } else {
          methodName = item.name;
        }

        // Expresión regular para encontrar la definición de la función/método
        let methodPattern;
        if (className) {
          // Si pertenece a una clase, búsqueda más específica
          methodPattern = new RegExp(
            `(public|private|protected)\\s+\\w+\\s+${methodName}\\s*\\(`
          );
        } else {
          // Búsqueda más general para funciones no asociadas a clases
          methodPattern = new RegExp(`\\b\\w+\\s+${methodName}\\s*\\(`);
        }

        // Buscar la clase primero si es necesario
        let classFound = false;
        let searchStartLine = 0;

        if (className) {
          const classPattern = new RegExp(`class\\s+${className}\\b`);
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            if (classPattern.test(lines[lineNum])) {
              classFound = true;
              searchStartLine = lineNum;
              break;
            }
          }
        }

        // Si no hay clase o la clase fue encontrada, buscar el método
        if (!className || classFound) {
          // Buscar la línea donde comienza la función
          for (
            let lineNum = searchStartLine;
            lineNum < lines.length;
            lineNum++
          ) {
            if (methodPattern.test(lines[lineNum])) {
              updatedItems[i].startLine = lineNum + 1;

              // Buscar dónde termina la función
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
                    updatedItems[i].endLine = j + 1;
                    break;
                  }
                }
              }

              break;
            }
          }
        }
      }
    }

    return updatedItems;
  };

  //Función para llamar al backend
  const executeCode = async () => {
    const activeFile = files.find((f) => f.active);
    if (!activeFile) return;

    setIsExecuting(true);
    setSalida("Ejecutando...");
    setEliminableItems([]); // Limpiar elementos eliminables anteriores

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

        // Procesar la respuesta para detectar elementos eliminables
        const items = processItemResponse(concatenatedResponses);
        // Encontrar la ubicación de estos elementos en el código
        const itemsWithLocations = findItemLocations(activeFile.content, items);
        setEliminableItems(itemsWithLocations);
      }
      if (data.errors != null) {
        const concatenatedErrors = data.errors
          .map((error: string) => error)
          .join("\n\n");
        setSalida(concatenatedErrors);
        setIsError(true);
        setEliminableItems([]); // Limpiar cuando hay errores
      }
      setIsExecuting(false);
      setHasExecuted(true);
    } catch (error) {
      console.error("Error al ejecutar el código:", error);
      setSalida(`Error al ejecutar: ${(error as Error).message}`);
      setIsError(true);
      setIsExecuting(false);
      setHasExecuted(true);
      setEliminableItems([]);
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
    // Limpiar elementos eliminables al cambiar de archivo
    setEliminableItems([]);
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
    // Limpiar elementos eliminables al cerrar archivo
    if (fileToRemove && fileToRemove.active) {
      setEliminableItems([]);
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
      // Limpiar elementos eliminables al cargar nuevos archivos
      setEliminableItems([]);
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
    setIsError(false);
    setHasExecuted(false);
    setEliminableItems([]);
  };

  // Función para eliminar una función del archivo activo
  const removeFunction = (item: EliminableItem) => {
    const activeFile = files.find((f) => f.active);
    if (!activeFile || item.startLine <= 0 || item.endLine <= 0) return;

    // Obtener el contenido del archivo actual
    const content = activeFile.content;
    const lines = content.split("\n");

    // Crear nuevo contenido sin la función eliminada
    const updatedLines = [
      ...lines.slice(0, item.startLine - 1),
      ...lines.slice(item.endLine),
    ];

    // Actualizar el contenido del archivo
    updateFileContent(activeFile.id, updatedLines.join("\n"));

    // Actualizar la lista de elementos eliminables
    setEliminableItems((prev) => prev.filter((i) => i.name !== item.name));

    // Añadir mensaje a la salida
    setSalida(
      (prev) =>
        `Función ${item.name} eliminada con éxito.\n\n${
          prev === "No hay salida" ? "" : prev
        }`
    );
  };

  // Función mejorada para sustituir variables
  const substituteVariable = (item: EliminableItem) => {
    console.log("Sustituyendo variable:", item);

    const activeFile = files.find((f) => f.active);
    if (!activeFile || item.type !== "variable" || !item.value) {
      console.log(
        "Error: archivo no encontrado, no es variable o no tiene valor"
      );
      return;
    }

    try {
      // Obtener el contenido actual
      let content = activeFile.content;
      const lines = content.split("\n");

      // Primero, eliminar la declaración de la variable
      if (item.startLine > 0 && item.startLine <= lines.length) {
        const lineToRemove = lines[item.startLine - 1];

        // Verificar si hay otras cosas en la misma línea después de la declaración
        const semicolonPos = lineToRemove.indexOf(";");
        const remainingText = lineToRemove.substring(semicolonPos + 1).trim();

        if (remainingText) {
          // Si hay más código después, solo eliminar la declaración
          lines[item.startLine - 1] = remainingText;
        } else {
          // Si no hay nada más, eliminar la línea completa
          lines.splice(item.startLine - 1, 1);
        }

        content = lines.join("\n");
      }

      // Si la variable pertenece a una clase y método específicos
      if (item.className && item.methodName) {
        let inClass = false;
        let inMethod = false;
        let braceCount = 0;
        const updatedLines = content.split("\n");
        const result: string[] = [];

        // Regular expressions para identificar la clase y método
        const classRegex = new RegExp(`class\\s+${item.className}\\b`);
        const methodRegex = new RegExp(`\\b${item.methodName}\\s*\\(`);

        // Regex para encontrar la variable en el contexto correcto
        const varRegex = new RegExp(`\\b${item.name}\\b(?!\\s*=)`, "g");

        for (let i = 0; i < updatedLines.length; i++) {
          let line = updatedLines[i];

          // Detectar si estamos en la clase correcta
          if (!inClass && classRegex.test(line)) {
            inClass = true;
          }

          // Detectar si estamos en el método correcto
          if (inClass && !inMethod && methodRegex.test(line)) {
            inMethod = true;
            braceCount = 0; // Reiniciar contador de llaves para este método

            // Contar llaves en la línea del método
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
          }

          // Si estamos en el método, contar llaves y hacer reemplazos
          else if (inMethod) {
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;

            // Reemplazar la variable por su valor constante
            if (braceCount >= 0) {
              line = line.replace(varRegex, item.value);
            }

            // Salir del método cuando el contador de llaves llegue a 0
            if (braceCount === 0) {
              inMethod = false;
            }
          }

          result.push(line);
        }

        content = result.join("\n");
      } else {
        // Si no tenemos información de clase/método, reemplazar globalmente
        // (Menos seguro, pero por si acaso)
        const regex = new RegExp(`\\b${item.name}\\b(?!\\s*=)`, "g");
        content = content.replace(regex, item.value);
      }

      // Actualizar el archivo con el contenido modificado
      updateFileContent(activeFile.id, content);

      // Eliminar de la lista de elementos
      setEliminableItems((prev) =>
        prev.filter(
          (i) =>
            !(
              i.name === item.name &&
              i.className === item.className &&
              i.methodName === item.methodName
            )
        )
      );

      // Actualizar mensaje de salida
      setSalida((prev) => {
        const newMessage = `Variable ${item.name} sustituida por su valor "${item.value}" en ${item.className}.${item.methodName}`;
        return prev === "No hay salida"
          ? newMessage
          : `${newMessage}\n\n${prev}`;
      });

      console.log("Variable sustituida exitosamente");
    } catch (error) {
      console.error("Error durante la sustitución:", error);
      setSalida((prev) => {
        const errorMessage = `Error al sustituir variable ${item.name}: ${error}`;
        return prev === "No hay salida"
          ? errorMessage
          : `${errorMessage}\n\n${prev}`;
      });
    }
  };

  // Nuevas funciones para manejar el redimensionamiento
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
    // Añadir clase para cambiar el cursor durante el drag
    document.body.classList.add("resizing");
  };

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const containerWidth =
      document.querySelector(".flex.flex-1.overflow-hidden")?.clientWidth || 0;
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
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", handleDragEnd);
    // Eliminar la clase del cursor
    document.body.classList.remove("resizing");
  }, [handleDrag]);

  // Limpiar los event listeners cuando el componente se desmonta
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
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
                    eliminableItems={eliminableItems}
                    activeResultsTab={activeResultsTab}
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
                    eliminableItems={eliminableItems}
                    removeFunction={removeFunction}
                    substituteVariable={substituteVariable}
                    activeTab={activeResultsTab}
                    setActiveTab={setActiveResultsTab}
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
      <style>{`
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

// Componente para el editor Monaco
interface MonacoEditorProps {
  initialContent: string;
  fileName: string;
  setCursorPosition: (position: { lineNumber: number; column: number }) => void;
  onChange: (value: string) => void;
  eliminableItems: EliminableItem[];
  activeResultsTab: ResultsTab;
}

const MonacoEditor = ({
  initialContent,
  fileName,
  setCursorPosition,
  onChange,
  eliminableItems,
  activeResultsTab,
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
          // Revisar si la línea actual contiene una función eliminable
          for (const item of eliminableItems) {
            if (
              item.type === "function" &&
              position.lineNumber >= item.startLine &&
              position.lineNumber <= item.endLine
            ) {
              // Determinar si es eliminable o reducible basado en la razón
              const isEliminable = item.reason.toLowerCase().includes('nunca') || 
                                  item.reason.toLowerCase().includes('no es llamad') ||
                                  item.reason.toLowerCase().includes('sin uso');
              
              const actionType = isEliminable ? 'eliminar' : 'reducir';
              const severity = isEliminable ? 'eliminable' : 'reducible';
              
              return {
                contents: [
                  { value: `**Función ${severity}**` },
                  {
                    value: `La función ${item.name} se puede ${actionType} ya que ${item.reason}.`,
                  },
                ],
              };
            }

            // Revisar si la línea actual contiene una variable eliminable
            if (
              item.type === "variable" &&
              position.lineNumber === item.startLine
            ) {
              return {
                contents: [
                  { value: `**Variable eliminable**` },
                  {
                    value: `La variable ${item.name} es eliminable ya que ${item.reason}.`,
                  },
                  {
                    value: `Valor asignado: ${item.value}`,
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
  }, [fileName]);

  // Actualización externa del contenido
  useEffect(() => {
    if (monacoEditorRef.current && initialContent !== content) {
      monacoEditorRef.current.setValue(initialContent);
      setContent(initialContent);
    }
  }, [initialContent]);

  // Función para determinar si una función es eliminable o reducible
  const categorizeFunction = (item: EliminableItem) => {
    if (item.type !== "function") return null;
    
    // Palabras clave que indican que se puede eliminar completamente
    const eliminableKeywords = ['nunca', 'no es llamad', 'sin uso', 'no utilizada', 'no se invoca', 'eliminar'];
    const isEliminable = eliminableKeywords.some(keyword => 
      item.reason.toLowerCase().includes(keyword)
    );
    
    // Priorizar eliminable sobre reducible - si puede eliminarse, siempre será rojo
    return isEliminable ? 'eliminable' : 'reducible';
  };

  // Manejar las decoraciones para elementos eliminables
  useEffect(() => {
    if (!monacoEditorRef.current) return;

    // Limpiar decoraciones existentes
    if (decorationsRef.current.length > 0) {
      monacoEditorRef.current.deltaDecorations(decorationsRef.current, []);
      decorationsRef.current = [];
    }

    // Si no hay elementos eliminables, no hacemos nada más
    if (eliminableItems.length === 0) return;

    // Separar funciones y variables
    const eliminableFunctions = eliminableItems.filter(
      (item) => item.type === "function"
    );
    const eliminableVariables = eliminableItems.filter(
      (item) => item.type === "variable"
    );

    // Mostrar solo las decoraciones según la pestaña activa
    let filteredItems = eliminableItems;
    if (activeResultsTab === "methods") {
      filteredItems = eliminableFunctions;
    } else if (activeResultsTab === "variables") {
      filteredItems = eliminableVariables;
    }

    // Crear decoraciones para funciones (diferenciando entre eliminables y reducibles)
    const functionDecorations = filteredItems
      .filter(
        (item) =>
          item.type === "function" && item.startLine > 0 && item.endLine > 0
      )
      .map((func) => {
        const category = categorizeFunction(func);
        const isEliminable = category === 'eliminable';
        
        return {
          range: new monaco.Range(func.startLine, 1, func.endLine, 1),
          options: {
            isWholeLine: true,
            className: isEliminable ? "eliminable-function" : "reducible-function",
            glyphMarginClassName: isEliminable ? "eliminable-function-glyph" : "reducible-function-glyph",
            overviewRuler: {
              color: "#ff4444", // Solo rojo para todas las funciones (eliminables y reducibles)
              position: monaco.editor.OverviewRulerLane.Left,
            },
            minimap: {
              color: "#ff4444", // Solo rojo para todas las funciones (eliminables y reducibles)
              position: monaco.editor.MinimapPosition.Inline,
            },
            inlineClassName: isEliminable ? "eliminable-function-inline" : "reducible-function-inline",
            linesDecorationsClassName: isEliminable ? "eliminable-function-line-decoration" : "reducible-function-line-decoration",
            marginClassName: isEliminable ? "eliminable-function-margin" : "reducible-function-margin",
          },
        };
      });

    // Crear decoraciones para variables (mantener como estaba)
    const variableDecorations = filteredItems
      .filter((item) => item.type === "variable" && item.startLine > 0)
      .map((variable) => ({
        range: new monaco.Range(variable.startLine, 1, variable.startLine, 1),
        options: {
          isWholeLine: true,
          className: "eliminable-variable",
          glyphMarginClassName: "eliminable-variable-glyph",
          overviewRuler: {
            color: "#ffa500",
            position: monaco.editor.OverviewRulerLane.Right,
          },
          minimap: {
            color: "#ffa500",
            position: monaco.editor.MinimapPosition.Inline,
          },
          inlineClassName: "eliminable-variable-inline",
          linesDecorationsClassName: "eliminable-variable-line-decoration",
          marginClassName: "eliminable-variable-margin",
        },
      }));

    // Combinar todas las decoraciones
    const allDecorations = [...functionDecorations, ...variableDecorations];

    // Aplicar las decoraciones
    if (allDecorations.length > 0) {
      decorationsRef.current = monacoEditorRef.current.deltaDecorations(
        [],
        allDecorations
      );

      // Añadir marcadores para funciones y variables
      const model = monacoEditorRef.current.getModel();
      if (model) {
        const functionMarkers = filteredItems
          .filter((item) => item.type === "function" && item.startLine > 0)
          .map((func) => {
            const category = categorizeFunction(func);
            const isEliminable = category === 'eliminable';
            const action = isEliminable ? 'eliminar' : 'reducir';
            
            return {
              startLineNumber: func.startLine,
              startColumn: 1,
              endLineNumber: func.startLine,
              endColumn: model.getLineContent(func.startLine).length + 1,
              message: `La función ${func.name} se puede ${action} ya que ${func.reason}.`,
              severity: isEliminable ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            };
          });

        // Añadir marcadores para variables
        const variableMarkers = filteredItems
          .filter((item) => item.type === "variable" && item.startLine > 0)
          .map((variable) => ({
            startLineNumber: variable.startLine,
            startColumn: 1,
            endLineNumber: variable.startLine,
            endColumn: model.getLineContent(variable.startLine).length + 1,
            message: `La variable ${variable.name} es eliminable ya que ${variable.reason}. Valor: ${variable.value}`,
            severity: monaco.MarkerSeverity.Info,
          }));

        // Combinar todos los marcadores
        const allMarkers = [...functionMarkers, ...variableMarkers];

        monaco.editor.setModelMarkers(model, "eliminableItems", allMarkers);
      }
    }
  }, [eliminableItems, activeResultsTab]);

  return (
    <>
      <style>{`
        /* Estilos para funciones eliminables (rojo más intenso) */
        .eliminable-function-inline {
          text-decoration: line-through;
          opacity: 0.6;
          background-color: rgba(255, 68, 68, 0.2);
        }
        .eliminable-function {
          background-color: rgba(255, 68, 68, 0.15);
          border-left: 3px solid #ff4444;
        }
        .eliminable-function-line-decoration {
          background-color: #ff4444;
          width: 6px !important;
          margin-left: 3px;
        }
        .eliminable-function-margin {
          background-color: rgba(255, 68, 68, 0.3);
        }
        
        /* Estilos para funciones reducibles (naranja) */
        .reducible-function-inline {
          text-decoration: underline wavy #ff8800;
          opacity: 0.8;
          background-color: rgba(255, 136, 0, 0.1);
        }
        .reducible-function {
          background-color: rgba(255, 136, 0, 0.1);
          border-left: 3px solid #ff8800;
        }
        .reducible-function-line-decoration {
          background-color: #ff8800;
          width: 5px !important;
          margin-left: 3px;
        }
        .reducible-function-margin {
          background-color: rgba(255, 136, 0, 0.2);
        }
        
        /* Estilos para variables eliminables (mantener como estaba) */
        .eliminable-variable-inline {
          text-decoration: underline wavy orange;
          opacity: 0.8;
        }
        .eliminable-variable {
          background-color: rgba(255, 165, 0, 0.1);
        }
        .eliminable-variable-line-decoration {
          background-color: rgba(255, 165, 0, 0.7);
          width: 5px !important;
          margin-left: 3px;
        }
        .eliminable-variable-margin {
          background-color: rgba(255, 165, 0, 0.2);
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
  eliminableItems: EliminableItem[];
  activeResultsTab: ResultsTab;
}

const EditorPanel = ({
  file,
  setCursorPosition,
  updateFileContent,
  executeCode,
  isExecuting,
  eliminableItems,
  activeResultsTab,
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
          eliminableItems={eliminableItems}
          activeResultsTab={activeResultsTab}
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
  eliminableItems: EliminableItem[];
  removeFunction: (item: EliminableItem) => void;
  substituteVariable: (item: EliminableItem) => void;
  activeTab: ResultsTab;
  setActiveTab: (tab: ResultsTab) => void;
}

const ResultsPanel = ({
  salida,
  isError,
  hasExecuted,
  clearOutput,
  eliminableItems,
  removeFunction,
  substituteVariable,
  activeTab,
  setActiveTab,
}: ResultsPanelProps) => {
  // Separar elementos por tipo
  const eliminableFunctions = eliminableItems.filter(
    (item) => item.type === "function"
  );
  const eliminableVariables = eliminableItems.filter(
    (item) => item.type === "variable"
  );

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
          <button onClick={clearOutput} title="Limpiar salida">
            <div className="flex text-sm items-center justify-center bg-gray-600 hover:bg-gray-500 text-white p-1 rounded cursor-pointer">
              Clear
            </div>
          </button>
        )}
      </div>

      {/* Sección de salida/errores */}
      <div className="flex-shrink-0">
        <div className="p-2 bg-gray-700 text-gray-300 border-b border-gray-600">
          <h3 className="text-sm font-medium">Salida de ejecución</h3>
        </div>
        <div
          className={`p-3 max-h-32 overflow-auto rounded-none border-b ${
            isError
              ? "bg-gray-900 border-gray-700 text-red-300"
              : "bg-gray-900 border-gray-700 text-gray-300"
          }`}
        >
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {salida}
          </pre>
        </div>
      </div>

      {/* Pestañas para elementos eliminables */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab("methods")}
          className={`flex-1 py-2 text-sm ${
            activeTab === "methods"
              ? "bg-gray-700 text-white border-b-2 border-blue-500"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          Métodos ({eliminableFunctions.length})
        </button>
        <button
          onClick={() => setActiveTab("variables")}
          className={`flex-1 py-2 text-sm ${
            activeTab === "variables"
              ? "bg-gray-700 text-white border-b-2 border-blue-500"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          Variables ({eliminableVariables.length})
        </button>
      </div>

      {/* Sección de elementos eliminables */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-2 bg-gray-700 text-gray-300 border-b border-gray-600">
          <h3 className="text-sm font-medium">
            {activeTab === "methods"
              ? "Métodos Eliminables"
              : "Variables Eliminables"}
          </h3>
        </div>
        <div className="flex-1 overflow-auto p-3 bg-gray-900">
          {eliminableItems.length === 0 ? (
            <p className="text-gray-500 text-sm italic">
              No se detectaron elementos eliminables
            </p>
          ) : activeTab === "variables" && eliminableVariables.length === 0 ? (
            <p className="text-gray-500 text-sm italic">
              No se detectaron variables eliminables
            </p>
          ) : activeTab === "methods" && eliminableFunctions.length === 0 ? (
            <p className="text-gray-500 text-sm italic">
              No se detectaron métodos eliminables
            </p>
          ) : (
            <div className="space-y-4">
              {/* Mostrar elementos según la pestaña seleccionada */}
              {activeTab === "variables" && (
                <ul className="space-y-2">
                  {eliminableVariables.map((variable, index) => (
                    <li
                      key={`var-${index}`}
                      className="p-2 bg-gray-800 rounded border border-gray-700"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-orange-400 font-mono text-sm font-semibold">
                              {variable.name}
                            </span>
                            <span className="text-xs bg-orange-600 text-white px-1 py-0.5 rounded">
                              Variable
                            </span>
                          </div>
                          <p className="text-gray-300 text-xs mb-1">
                            {variable.reason}
                          </p>
                          {variable.value && (
                            <p className="text-blue-300 text-xs">
                              <span className="text-gray-400">Valor:</span>{" "}
                              <code>{variable.value}</code>
                            </p>
                          )}
                          {variable.startLine > 0 && (
                            <span className="text-gray-500 text-xs">
                              (línea {variable.startLine})
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {activeTab === "methods" && (
                <ul className="space-y-2">
                  {eliminableFunctions.map((func, index) => (
                    <li
                      key={`func-${index}`}
                      className="p-2 bg-gray-800 rounded border border-gray-700"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-red-400 font-mono text-sm font-semibold">
                              {func.name}
                            </span>
                            <span className="text-xs bg-red-600 text-white px-1 py-0.5 rounded">
                              Función
                            </span>
                            {func.isOnce && (
                              <span className="text-xs bg-yellow-600 text-white px-1 py-0.5 rounded">
                                Llamada 1 vez
                              </span>
                            )}
                            {func.isReturned && (
                              <span className="text-xs bg-blue-900 text-white px-1 py-0.5 rounded">
                                Retorna constante
                              </span>
                            )}
                          </div>
                          <p className="text-gray-300 text-xs mb-1">
                            {func.reason}
                          </p>
                          {func.startLine > 0 && func.endLine > 0 && (
                            <span className="text-gray-500 text-xs">
                              (líneas {func.startLine}-{func.endLine})
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2">
                          {/* Solo mostrar botón eliminar si NO es isOnce y NO es isReturned */}
                          {!func.isOnce && !func.isReturned && (
                            <button
                              onClick={() => removeFunction(func)}
                              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs cursor-pointer transition-colors"
                              title={`Eliminar función ${func.name}`}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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

// Componente para las pestañas del editor
interface EditorTabsProps {
  files: File[];
  activateFile: (id: number) => void;
  closeFile: (id: number, e: React.MouseEvent<HTMLButtonElement>) => void;
}

const EditorTabs = ({ files, activateFile, closeFile }: EditorTabsProps) => {
  return (
    <div className="flex overflow-x-auto bg-gray-800 border-b border-gray-700">
      {files.map((file) => (
        <div
          key={file.id}
          className={`flex items-center px-3 py-2 border-r border-gray-700 cursor-pointer min-w-0 ${
            file.active
              ? "bg-gray-700 text-white"
              : "bg-gray-800 hover:bg-gray-700 text-gray-300"
          }`}
          onClick={() => activateFile(file.id)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2 flex-shrink-0"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span className="text-sm truncate flex-1">{file.name}</span>
          <button
            onClick={(e) => closeFile(file.id, e)}
            className="ml-2 text-gray-500 hover:text-white flex-shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

export default IDE;
