cmake_minimum_required(VERSION 3.24)
project(streamify_obs VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(libobs CONFIG REQUIRED)
find_package(obs-frontend-api CONFIG REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Widgets Network)

add_library(streamify-obs MODULE
  src/plugin-main.cpp
)

target_include_directories(streamify-obs PRIVATE
  ${LIBOBS_INCLUDE_DIRS}
)

target_link_libraries(streamify-obs PRIVATE
  OBS::libobs
  OBS::frontend-api
  Qt6::Widgets
  Qt6::Network
)

target_compile_definitions(streamify-obs PRIVATE
  STREAMIFY_PLUGIN_VERSION="${PROJECT_VERSION}"
)

set_target_properties(streamify-obs PROPERTIES
  PREFIX ""
  OUTPUT_NAME "streamify-obs"
)

if(WIN32)
  set_target_properties(streamify-obs PROPERTIES SUFFIX ".dll")
endif()
