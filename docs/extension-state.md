# TMC Extension state

The TMC Extension saves local data in the Visual Studio Code state.vscdb file.

In this document we will shortly describe what kind of data is saved there by examples.

## UserData

This is an example of data related to the User.

Accessing data in the VSCode state: 
```
sqlite3 state.vscdb
SELECT * FROM ItemTable WHERE key = "moocfi.test-my-code";
```

The saved data looks like this:
```javascript
    "userData": {
        // Array of courses, which are shown in My Courses view
        "courses": [
            {
                "description": "TMC exercises for the course Data Analysis with Python - Spring 2020. ",
                // This array of exercises contains the exercises the user has downloaded.
                "exercises": [
                    {
                        "id": 85619,
                        // If passed on the TMC server and awarded full points.
                        "passed": true,
                        "name": "osa08-Osa08_09.HajautustaulunTulostelua2"
                    },
                    {
                        "id": 85617,
                        "passed": true,
                        "name": "osa08-Osa08_09.HajautustaulunTulostelua2"
                    },
                ],
                // The course details below.
                "id": 614,
                "name": "hy-data-analysis-with-python-spring-2020",
                "title": "Ohjelmoinnin MOOC 2017",
                "organization": "hy",
                "awardedPoints": 57,
                "availablePoints": 151,
                // Array of numbers containing new exercises that has been found when running updateCourse()
                "newExercises": [85620, 85621],
                // Time in milliseconds when to notify user if he chose "Remind me later" for downloading new exercises or updates
                "notifyAfter": 1587732934687,
                // If course disabled from API
                "disabled": false,
                "material_url": "http://python-mooc.fi/material",
            }
        ]
    }
```
## ExerciseData

This is an example of data related to the Workspace state.

```javascript
    "exerciseData": [
            {
                // Checksum for the exercise
                "checksum": "056425165b90d3d9ab3bb159d33e0711",
                // The name of the course which the exercise is in
                "course": "mooc-2020-ohjelmointi-ii",
                // Hard deadline for the exercise if exists, otherwise null
                "deadline": "2020-03-16T23:59:59.999+02:00",
                // Exercise ID
                "id": 85890,
                // 0 = Open, 1 = Closed, 2 = Missing (enum ExerciseStatus)
                "status": 2,
                // Name of the exercise
                "name": "osa08-Osa08_09.HajautustaulunTulostelua2",
                // The organisation under where the exercise is
                "organization": "mooc",
                // Soft deadline if exists, otherwise null
                "softDeadline": "2020-03-16T23:59:00.000+02:00",
            },
        ]
```

## ExtensionSettings

Example of the extension settings.

```javascript
"extensionSettings": {
        "dataPath": "g:\\tmc-data-path\\tmcdata",
        "logLevel": "verbose",
        "hideMetaFiles": false
    },
```